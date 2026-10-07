import { afterEach, describe, expect, test } from "bun:test";
import { ChatGptTokenError, refreshChatGPTToken } from "../../src/oauth/chatgpt";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const FALLBACK_MS = 3600 * 1000;
const TOLERANCE_MS = 30_000;

describe("ChatGPT OAuth token response parsing", () => {
  test("refresh with a non-finite expires_in falls back to the 3600s default", async () => {
    globalThis.fetch = (async () => new Response(
      // JSON.stringify would turn Infinity into null; hand-write 1e999 so JSON.parse
      // yields Infinity, which ?? 3600 alone would let through (NaN expiry, never refreshing).
      '{"access_token":"at","refresh_token":"rt","expires_in":1e999}',
      { status: 200 },
    )) as typeof fetch;

    const before = Date.now();
    const cred = await refreshChatGPTToken("secret");
    expect(Number.isFinite(cred.expires)).toBe(true);
    expect(cred.expires).toBeGreaterThan(before);
    expect(Math.abs(cred.expires - (before + FALLBACK_MS))).toBeLessThan(TOLERANCE_MS);
  });

  test("refresh with a string expires_in falls back to the 3600s default", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: "garbage" }),
      { status: 200 },
    )) as typeof fetch;

    const before = Date.now();
    const cred = await refreshChatGPTToken("secret");
    expect(Number.isFinite(cred.expires)).toBe(true);
    expect(cred.expires).toBeGreaterThan(before);
    expect(Math.abs(cred.expires - (before + FALLBACK_MS))).toBeLessThan(TOLERANCE_MS);
  });

  test("refresh with an overflowing expires_in falls back to the 3600s default", async () => {
    globalThis.fetch = (async () => new Response(
      // Number.MAX_VALUE passes Number.isFinite but overflows to Infinity when
      // multiplied by 1000 — the computed expiry must still be guarded.
      '{"access_token":"at","refresh_token":"rt","expires_in":1.7976931348623157e308}',
      { status: 200 },
    )) as typeof fetch;

    const before = Date.now();
    const cred = await refreshChatGPTToken("secret");
    expect(Number.isFinite(cred.expires)).toBe(true);
    expect(cred.expires).toBeGreaterThan(before);
    expect(Math.abs(cred.expires - (before + FALLBACK_MS))).toBeLessThan(TOLERANCE_MS);
  });

  test("refresh with a negative expires_in falls back to the 3600s default", async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: -1 }),
      { status: 200 },
    )) as typeof fetch;

    const before = Date.now();
    const cred = await refreshChatGPTToken("secret");
    expect(Number.isFinite(cred.expires)).toBe(true);
    expect(cred.expires).toBeGreaterThan(before);
    expect(Math.abs(cred.expires - (before + FALLBACK_MS))).toBeLessThan(TOLERANCE_MS);
  });
});

describe("ChatGPT OAuth refresh failure classification", () => {
  const errorBody = (status: number, body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  test("a named dead-grant code surfaces as a terminal ChatGptTokenError", async () => {
    globalThis.fetch = (async () => errorBody(400, {
      error: "refresh_token_expired",
      error_description: "The refresh token has expired",
    })) as typeof fetch;

    const err = await refreshChatGPTToken("secret").then(
      () => { throw new Error("expected rejection"); },
      (e: unknown) => e,
    );
    // `refresh_token_expired` never reached the generic substring classifier, so a
    // dead grant used to retry forever instead of marking the account needsReauth.
    expect(err).toBeInstanceOf(ChatGptTokenError);
    const tokenErr = err as ChatGptTokenError;
    expect(tokenErr.httpStatus).toBe(400);
    expect(tokenErr.oauthError).toBe("refresh_token_expired");
    expect(tokenErr.terminal).toBe(true);
  });

  test("revoked grant codes are terminal", async () => {
    for (const code of ["invalid_grant", "refresh_token_reused", "refresh_token_invalidated", "token_invalidated"]) {
      globalThis.fetch = (async () => errorBody(401, { error: code })) as typeof fetch;
      const err = await refreshChatGPTToken("secret").then(
        () => { throw new Error("expected rejection"); },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ChatGptTokenError);
      expect((err as ChatGptTokenError).terminal).toBe(true);
      expect((err as ChatGptTokenError).oauthError).toBe(code);
    }
  });

  test("transient server failures stay retryable", async () => {
    globalThis.fetch = (async () => errorBody(503, {
      error: "temporarily_unavailable",
      error_description: "try again later",
    })) as typeof fetch;

    const err = await refreshChatGPTToken("secret").then(
      () => { throw new Error("expected rejection"); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatGptTokenError);
    const tokenErr = err as ChatGptTokenError;
    expect(tokenErr.terminal).toBe(false);
    expect(tokenErr.oauthError).toBe("temporarily_unavailable");
  });

  test("a non-JSON error body is not terminal and still reports the status", async () => {
    globalThis.fetch = (async () => errorBody(500, "upstream exploded")) as typeof fetch;
    const err = await refreshChatGPTToken("secret").then(
      () => { throw new Error("expected rejection"); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatGptTokenError);
    const tokenErr = err as ChatGptTokenError;
    expect(tokenErr.terminal).toBe(false);
    expect(tokenErr.oauthError).toBeUndefined();
    expect(tokenErr.message).toContain("500");
  });

  test("the caller's abort signal reaches the fetch", async () => {
    let observed: AbortSignal | null | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      observed = init?.signal;
      return new Response('{"access_token":"at","refresh_token":"rt","expires_in":3600}', { status: 200 });
    }) as typeof fetch;

    const caller = new AbortController();
    await refreshChatGPTToken("secret", { signal: caller.signal });
    // The registration used to drop the caller's signal entirely; the combined
    // signal must carry the caller's abort AND the per-fetch timeout.
    expect(observed).toBeDefined();
    expect(observed!.aborted).toBe(false);
    caller.abort();
    expect(observed!.aborted).toBe(true);
  });

  test("the fetch deadline aborts a stalled refresh", async () => {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () =>
          reject(signal.reason ?? new DOMException("aborted", "AbortError")));
      })) as typeof fetch;

    const start = Date.now();
    // Without the deadline this hung fetch would pin the refresh intent lock
    // forever; an injectable bound proves the composite signal fires on its own.
    await expect(refreshChatGPTToken("secret", { timeoutMs: 50 })).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
