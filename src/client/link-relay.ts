import {
  boundedRelayResponseStream,
  filterRelayHeaders,
  headersWithinLimit,
  HUB_RELAY_DEFAULT_TIMEOUT_MS,
  HUB_RELAY_REQUEST_BODY_MAX_BYTES,
  HUB_RELAY_RESPONSE_BODY_MAX_BYTES,
  readBoundedRelayRequestBody,
  validateHubRelayRequestHeaders,
} from "./hub-relay";
import { linkRouteAllowed } from "../link/routes";
import { isLinkPort } from "../link/ports";
import { LINK_RELAY_AUTH_PATH, linkRelayChallenge, linkRelayProofMatches } from "../link/relay-auth";

export interface LinkRelayTarget {
  tunnelPort: number;
  linkId: string;
  apiKeyId: string;
  tokenFingerprint: string;
}

export interface LinkRelayClock {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface LinkRelayDeps {
  fetchImpl?: typeof fetch;
  clock?: LinkRelayClock;
  timeoutMs?: number;
  sseIdleTimeoutMs?: number;
}

export const LINK_RELAY_RETRY_AFTER_SECONDS = 1;
export const LINK_RELAY_SSE_IDLE_TIMEOUT_MS = 300_000;

const defaultClock: LinkRelayClock = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};
const REQUEST_OMITTED_HEADERS = new Set(["content-length", "host"]);
const RESPONSE_OMITTED_HEADERS = new Set(["content-encoding", "content-length"]);

function jsonError(status: number, error: string, retry = false): Response {
  const headers = retry ? { "Retry-After": String(LINK_RELAY_RETRY_AFTER_SECONDS) } : undefined;
  return Response.json({ error }, { status, headers });
}

export function linkRelayDestination(url: URL, target: LinkRelayTarget): string {
  if (!isLinkPort(target.tunnelPort)) {
    throw new RangeError("invalid link tunnel port");
  }
  return `http://127.0.0.1:${target.tunnelPort}${url.pathname}${url.search}`;
}

type LinkRelayAuth = "authenticated" | "unavailable" | "unrecognized";

async function authenticateLinkRelayTarget(
  target: LinkRelayTarget,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<LinkRelayAuth> {
  if (!target.apiKeyId.trim() || !/^lnk_[0-9a-f]{16}$/.test(target.linkId)
    || !/^[a-f0-9]{64}$/.test(target.tokenFingerprint)) return "unavailable";
  const challenge = linkRelayChallenge(target.tokenFingerprint, target.linkId);
  const url = new URL(`http://127.0.0.1:${target.tunnelPort}${LINK_RELAY_AUTH_PATH}`);
  url.searchParams.set("key", target.apiKeyId);
  url.searchParams.set("link", target.linkId);
  url.searchParams.set("nonce", challenge.nonce);
  url.searchParams.set("proof", challenge.callerProof);
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal });
    if (response.status === 404) return "unrecognized";
    return response.status === 204
      && linkRelayProofMatches(response.headers.get("x-opencodex-link-proof"), challenge.expectedProof)
      ? "authenticated" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function forwardLinkRequestHeaders(source: Headers): Headers {
  const validation = validateHubRelayRequestHeaders([...source]);
  if (!validation.ok) return new Headers();
  const omitted = new Set([...REQUEST_OMITTED_HEADERS, ...validation.connectionNamed]);
  return filterRelayHeaders(source, undefined, omitted);
}

export function sanitizeLinkResponseHeaders(source: Headers): Headers {
  const connectionNamed = new Set((source.get("connection") ?? "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  return filterRelayHeaders(source, undefined, new Set([...RESPONSE_OMITTED_HEADERS, ...connectionNamed]));
}

function isSse(headers: Headers): boolean {
  return headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream";
}

function idleBoundedStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  clock: LinkRelayClock,
  idleTimeoutMs: number,
  onIdle: () => void,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let closed = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const clearIdleTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearIdleTimer();
    signal.removeEventListener("abort", onAbort);
    cleanup();
    try { reader.releaseLock(); } catch { /* a pending read may still own it */ }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    try { controllerRef?.close(); } catch { /* the consumer may have cancelled */ }
  };
  const cancelUpstream = (reason: unknown, closeResponse: boolean) => {
    if (finished) return;
    clearIdleTimer();
    try {
      void reader.cancel(reason).catch(() => undefined).finally(() => {
        finish();
        if (closeResponse) close();
      });
    } catch {
      finish();
      if (closeResponse) close();
    }
  };
  const onAbort = () => cancelUpstream(signal.reason, true);
  const armIdleTimer = () => {
    clearIdleTimer();
    timer = clock.setTimeout(() => {
      onIdle();
      cancelUpstream(new DOMException("link relay SSE idle timeout", "TimeoutError"), true);
    }, idleTimeoutMs);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      if (signal.aborted) onAbort();
      else armIdleTimer();
    },
    async pull(controller) {
      if (closed) return;
      try {
        const next = await reader.read();
        if (next.done) {
          finish();
          closed = true;
          controller.close();
          return;
        }
        if (next.value.byteLength > 0) armIdleTimer();
        controller.enqueue(next.value);
      } catch (error) {
        finish();
        if (!closed) {
          closed = true;
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      cancelUpstream(reason, false);
    },
  });
}

export async function relayLinkDataRequest(
  req: Request,
  target: LinkRelayTarget,
  deps: LinkRelayDeps = {},
): Promise<Response> {
  const url = new URL(req.url);
  if (!linkRouteAllowed(url, req)) return jsonError(404, "not_found");
  let destination: string;
  try { destination = linkRelayDestination(url, target); } catch { return jsonError(404, "not_found"); }
  const validation = validateHubRelayRequestHeaders([...req.headers]);
  if (!validation.ok) return jsonError(400, "link relay request headers refused");

  let body: Uint8Array<ArrayBuffer> | null;
  try {
    body = req.method === "GET" || req.method === "HEAD"
      ? null
      : await readBoundedRelayRequestBody(req.body, req.headers.get("content-length"), HUB_RELAY_REQUEST_BODY_MAX_BYTES);
  } catch {
    return jsonError(413, "link relay request body too large");
  }
  const headers = forwardLinkRequestHeaders(req.headers);
  if (!headersWithinLimit(headers)) {
    return jsonError(431, "link relay request headers too large");
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const relayAbort = new AbortController();
  const timeoutMs = typeof deps.timeoutMs === "number" && Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0
    ? Math.min(Math.floor(deps.timeoutMs), 120_000)
    : HUB_RELAY_DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const onTimeout = () => relayAbort.abort(timeoutSignal.reason);
  const onClientAbort = () => relayAbort.abort(req.signal.reason);
  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  req.signal.addEventListener("abort", onClientAbort, { once: true });
  const cleanup = () => {
    timeoutSignal.removeEventListener("abort", onTimeout);
    req.signal.removeEventListener("abort", onClientAbort);
  };
  if (req.signal.aborted) onClientAbort();
  else if (timeoutSignal.aborted) onTimeout();

  const auth = await authenticateLinkRelayTarget(target, fetchImpl, relayAbort.signal);
  if (auth !== "authenticated") {
    cleanup();
    // A listener that answers 404 either predates relay authentication or no longer holds this
    // link record — refusing stays fail-closed either way, but name the migration: the hub must
    // be upgraded (or the link remade) before a newer client can carry data requests.
    return jsonError(503, auth === "unrecognized"
      ? "link tunnel refused the relay challenge — upgrade the hub to a version with link-relay auth"
      : "link tunnel unavailable", true);
  }

  let upstream: Response;
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: req.method,
      headers,
      redirect: "manual",
      signal: relayAbort.signal,
      ...(body ? { body, duplex: "half" } : {}),
    };
    upstream = await fetchImpl(destination, init);
  } catch {
    cleanup();
    return jsonError(503, "link tunnel unavailable", true);
  }
  if (relayAbort.signal.aborted) {
    cleanup();
    try { await upstream.body?.cancel(); } catch { /* best effort */ }
    return jsonError(503, "link tunnel unavailable", true);
  }

  const sse = isSse(upstream.headers);
  const responseHeaders = sanitizeLinkResponseHeaders(upstream.headers);
  if (!headersWithinLimit(responseHeaders)) {
    cleanup();
    try { await upstream.body?.cancel(); } catch { /* best effort */ }
    return jsonError(502, "link relay response headers too large");
  }
  const declaredLength = upstream.headers.get("content-length");
  if (!sse && declaredLength !== null && (!/^\d+$/.test(declaredLength)
    || Number(declaredLength) > HUB_RELAY_RESPONSE_BODY_MAX_BYTES)) {
    cleanup();
    try { await upstream.body?.cancel(); } catch { /* best effort */ }
    return jsonError(502, "link relay response body too large");
  }
  if (req.method === "HEAD" || !upstream.body) {
    cleanup();
    try { await upstream.body?.cancel(); } catch { /* best effort */ }
    return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  }

  // The handshake deadline ends once a response exists. The body owns cleanup after that.
  timeoutSignal.removeEventListener("abort", onTimeout);
  const responseBody = sse
    ? idleBoundedStream(upstream.body, relayAbort.signal, deps.clock ?? defaultClock,
      deps.sseIdleTimeoutMs ?? LINK_RELAY_SSE_IDLE_TIMEOUT_MS, () => relayAbort.abort(new DOMException("link relay SSE idle timeout", "TimeoutError")), cleanup)
    : boundedRelayResponseStream(upstream.body, HUB_RELAY_RESPONSE_BODY_MAX_BYTES, relayAbort.signal, cleanup);
  return new Response(responseBody, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}
