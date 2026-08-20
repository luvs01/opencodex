import { idleDeadline } from "./abort";

/**
 * Bound response-body silence after fetch has returned its headers. The deadline is armed only
 * while an upstream read is pending, so a downstream client applying backpressure does not count
 * as an upstream stall. Non-empty chunks reset the window; normal completion leaves the upstream
 * controller untouched.
 */
export function guardResponseBodyInactivity(
  response: Response,
  upstream: AbortController,
  inactivityMs: number,
): Response {
  if (!response.body || inactivityMs <= 0) return response;

  const reader = response.body.getReader();
  let settled = false;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  const timeoutError = new DOMException(
    `Upstream response body stalled for ${inactivityMs}ms`,
    "TimeoutError",
  );
  const idle = idleDeadline(inactivityMs, () => {
    if (settled) return;
    settled = true;
    upstream.abort(timeoutError);
    reader.cancel(timeoutError).catch(() => {});
    try { output?.error(timeoutError); } catch { /* already torn down */ }
  });

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      output = controller;
      try {
        idle.reset();
        for (;;) {
          const { done, value } = await reader.read();
          if (settled) return;
          if (done) {
            settled = true;
            idle.cancel();
            controller.close();
            return;
          }
          if (value.byteLength === 0) continue;
          idle.pause();
          controller.enqueue(value);
          return;
        }
      } catch (error) {
        if (settled) return;
        settled = true;
        idle.cancel();
        try { controller.error(error); } catch { /* already torn down */ }
      }
    },
    cancel(reason) {
      if (settled) return;
      settled = true;
      idle.cancel();
      upstream.abort(reason);
      reader.cancel(reason).catch(() => {});
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
