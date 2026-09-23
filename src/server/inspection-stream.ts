/** Limits inspection copies only; client-visible response bytes are never truncated. */
export const MAX_RESPONSE_LOG_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_RESPONSE_LOG_ERROR_BYTES = 8192;
export type InspectionEnd = "eof" | "error" | "cancel";

/** Pull-driven forwarding with one geometrically grown inspection buffer, not O(chunks) objects. */
export function inspectNonStreamBody(
  source: ReadableStream<Uint8Array>,
  json: boolean,
  onEnd: (kind: InspectionEnd, text: string | undefined) => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const limit = json ? MAX_RESPONSE_LOG_JSON_BYTES : MAX_RESPONSE_LOG_ERROR_BYTES;
  let bytes = new Uint8Array(0);
  let length = 0;
  let overflowed = false;
  let settled = false;
  const release = () => { try { reader.releaseLock(); } catch { /* A cancel may still be settling. */ } };
  const cancelSource = (reason: unknown) => {
    // Cancelling a tee branch may wait for its sibling; never make client cancellation wait for it.
    reader.cancel(reason).then(release, release);
  };
  const finish = (kind: InspectionEnd) => {
    if (settled) return;
    settled = true;
    const text = json && (overflowed || kind !== "eof")
      ? undefined : new TextDecoder().decode(bytes.subarray(0, length));
    bytes = new Uint8Array(0);
    length = 0;
    try { onEnd(kind, text); } catch { /* Best-effort logging cannot break delivery or cleanup. */ }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (settled) return;
        if (next.done) {
          finish("eof");
          release();
          controller.close();
          return;
        }
        const value = next.value;
        if (!overflowed) {
          if (json && value.byteLength > limit - length) {
            overflowed = true;
            bytes = new Uint8Array(0);
            length = 0;
          } else {
            const take = Math.min(value.byteLength, limit - length);
            const needed = length + take;
            if (needed > bytes.byteLength) {
              const grown = new Uint8Array(Math.min(limit, Math.max(4096, needed, bytes.byteLength * 2)));
              grown.set(bytes.subarray(0, length));
              bytes = grown;
            }
            bytes.set(value.subarray(0, take), length);
            length = needed;
          }
        }
        controller.enqueue(value);
      } catch (error) {
        if (settled) return;
        finish("error");
        cancelSource(error);
        try { controller.error(error); } catch { /* Already torn down. */ }
      }
    },
    cancel(reason) {
      if (settled) return;
      finish("cancel");
      cancelSource(reason);
    },
  }, { highWaterMark: 0 });
}

/**
 * Couple delivery and inspection reads, unlike native tee's unbounded slow-sibling queue.
 * Cancelling either branch lets its sibling continue; the inspection consumer owns its existing
 * post-client-cancel drain deadline. No total-stream cutoff may discard a late usage/terminal event.
 */
export function teeForInspection(source: ReadableStream<Uint8Array>): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
  const reader = source.getReader();
  const states: Array<{
    controller?: ReadableStreamDefaultController<Uint8Array>;
    wantsChunk: boolean;
    cancelled: boolean;
    reason?: unknown;
  }> = [{ wantsChunk: false, cancelled: false }, { wantsChunk: false, cancelled: false }];
  let reading = false;
  let finished = false;
  const release = () => { try { reader.releaseLock(); } catch { /* Cancellation is still settling. */ } };
  const pump = async () => {
    if (reading || finished || states.some(s => !s.cancelled && !s.wantsChunk)) return;
    reading = true;
    try {
      const next = await reader.read();
      if (finished) return;
      if (next.done) {
        finished = true;
        for (const state of states) if (!state.cancelled) state.controller!.close();
        release();
        return;
      }
      for (const state of states) {
        if (state.cancelled) continue;
        state.wantsChunk = false;
        state.controller!.enqueue(next.value);
      }
    } catch (error) {
      if (!finished) {
        finished = true;
        for (const state of states) if (!state.cancelled) state.controller!.error(error);
        release();
      }
    } finally {
      reading = false;
      if (!finished) void pump();
    }
  };
  const branch = (index: number) => new ReadableStream<Uint8Array>({
    start(controller) { states[index]!.controller = controller; },
    pull() { states[index]!.wantsChunk = true; void pump(); },
    cancel(reason) {
      const state = states[index]!;
      state.cancelled = true;
      state.reason = reason;
      if (finished) return;
      if (states.every(s => s.cancelled)) {
        finished = true;
        reader.cancel(states.map(s => s.reason)).then(release, release);
      } else void pump();
    },
  }, { highWaterMark: 0 });
  return [branch(0), branch(1)];
}
