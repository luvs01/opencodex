import { describe, expect, test } from "bun:test";
import { responseWithDeferredRequestLog } from "../../src/server/relay";
import type { RequestLogEntry } from "../../src/server/request-log";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const encoder = new TextEncoder();
const wrap = (body: ReadableStream<Uint8Array>, json: boolean, entries: RequestLogEntry[]) =>
  responseWithDeferredRequestLog(new Response(body, {
    status: json ? 200 : 500, statusText: json ? "OK" : "fixture failure",
    headers: { "content-type": json ? "application/json" : "application/octet-stream", "x-fixture": "preserved" },
  }), "bounded-log-fixture", Date.now(), { model: "fixture", provider: "openai" }, entry => entries.push(entry));

describe("bounded non-stream log inspection", () => {
  test.each([false, true])("does not drain ahead of an idle client (json=%s)", async json => {
    let pulls = 0;
    let cancellations = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(encoder.encode("data"));
        if (pulls === 128) controller.close();
      },
      cancel() { cancellations++; },
    }, { highWaterMark: 0 });
    const entries: RequestLogEntry[] = [];
    const response = wrap(source, json, entries);
    try {
      await tick();
      expect(pulls).toBeLessThanOrEqual(1);
      expect(entries).toHaveLength(0);
    } finally { await response.body!.cancel("idle client gone"); }
    expect(cancellations).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ status: 499, closeReason: "client_cancel" });
  });

  test("forwards error bytes without decode/re-encode corruption", async () => {
    const bytes = Uint8Array.of(0xff, 0xc3, 0x28, 0, 0x80, 0x0a);
    const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
    const entries: RequestLogEntry[] = [];
    const response = wrap(source, false, entries);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.status).toBe(500);
    expect(response.statusText).toBe("fixture failure");
    expect(response.headers.get("x-fixture")).toBe("preserved");
    expect(entries).toHaveLength(1);
  });

  test("cancels a pending upstream read and logs once", async () => {
    let upstream: ReadableStreamDefaultController<Uint8Array>;
    let cancellation: unknown;
    const source = new ReadableStream<Uint8Array>({ start(c) { upstream = c; }, cancel(reason) { cancellation = reason; } });
    const entries: RequestLogEntry[] = [];
    const response = wrap(source, true, entries);
    const reader = response.body!.getReader();
    const pending = reader.read();
    try {
      await tick();
      await reader.cancel("pending client gone");
      expect((await pending).done).toBe(true);
      expect(cancellation).toBe("pending client gone");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ status: 499, closeReason: "client_cancel" });
    } finally {
      try { upstream!.close(); } catch { /* Already cancelled. */ }
      reader.releaseLock();
      await tick();
    }
    expect(entries).toHaveLength(1);
  });

  test("forwards oversized JSON but does not inspect a truncated document as complete", async () => {
    const block = encoder.encode("x".repeat(32 * 1024));
    const start = encoder.encode('{"padding":"');
    const end = encoder.encode('","usage":{"input_tokens":9,"output_tokens":4}}');
    let part = -1;
    const source = new ReadableStream<Uint8Array>({
      pull(c) {
        if (part === -1) c.enqueue(start);
        else if (part < 1025) c.enqueue(block);
        else { c.enqueue(end); c.close(); }
        part++;
      },
    }, { highWaterMark: 0 });
    const entries: RequestLogEntry[] = [];
    const response = wrap(source, true, entries);
    const reader = response.body!.getReader();
    let bytes = 0;
    for (;;) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength; }
    expect(bytes).toBe(start.byteLength + 1025 * block.byteLength + end.byteLength);
    expect(entries).toHaveLength(1);
    expect(entries[0].usageStatus).toBe("unreported");
    expect(entries[0].usage).toBeUndefined();
    reader.releaseLock();
  });

  test("preserves complete small JSON metadata across UTF-8 chunk boundaries", async () => {
    const bytes = encoder.encode('{"text":"한글","usage":{"input_tokens":9,"output_tokens":4}}');
    let offset = 0;
    const source = new ReadableStream<Uint8Array>({ pull(c) {
      if (offset === bytes.length) { c.close(); return; }
      c.enqueue(bytes.slice(offset, ++offset));
    } }, { highWaterMark: 0 });
    const entries: RequestLogEntry[] = [];
    const response = wrap(source, true, entries);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ usageStatus: "reported", totalTokens: 13 });
  });
});
