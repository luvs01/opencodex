import { describe, expect, test } from "bun:test";
import { teeForInspection } from "../../src/server/inspection-stream";
import { consumeForInspection } from "../../src/server/relay";
import type { RequestLogContext } from "../../src/server/request-log";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function drain(body: ReadableStream<Uint8Array>): Promise<number> {
  const reader = body.getReader();
  let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) return size; size += next.value.byteLength; } }
  finally { reader.releaseLock(); }
}

describe("inspection tee ownership", () => {
  test("a fast inspector cannot drain past an idle client", async () => {
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>({ pull(c) {
      pulls++; c.enqueue(Uint8Array.of(pulls)); if (pulls === 100) c.close();
    } }, { highWaterMark: 0 });
    const [client, inspection] = teeForInspection(source);
    const inspected = drain(inspection);
    try {
      await tick();
      expect(pulls).toBeLessThanOrEqual(1);
    } finally { await client.cancel("client gone"); await inspected; }
    expect(pulls).toBe(100);
  });

  test("one branch cancellation does not await its live sibling", async () => {
    const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(1, 2)); c.close(); } });
    const [client, inspection] = teeForInspection(source);
    let settled = false;
    const cancelled = inspection.cancel("inspection detached").then(() => { settled = true; });
    try { await tick(); expect(settled).toBe(true); }
    finally { expect(await drain(client)).toBe(2); await cancelled; }
  });

  test("both cancellations settle pending reads and release the source once", async () => {
    let cancellations = 0;
    let reason: unknown;
    const source = new ReadableStream<Uint8Array>({ cancel(value) { cancellations++; reason = value; } });
    const [a, b] = teeForInspection(source).map(stream => stream.getReader());
    const ar = a!.read(); const br = b!.read();
    await tick();
    await Promise.all([a!.cancel("client"), b!.cancel("inspection")]);
    expect((await ar).done).toBe(true);
    expect((await br).done).toBe(true);
    await tick();
    expect(cancellations).toBe(1);
    expect(reason).toEqual(["client", "inspection"]);
    expect(source.locked).toBe(false);
    a!.releaseLock(); b!.releaseLock();
  });

  test("multiple pending reads preserve order and EOF on both branches", async () => {
    let i = 0;
    const source = new ReadableStream<Uint8Array>({ pull(c) {
      if (i === 4) { c.close(); return; } c.enqueue(Uint8Array.of(i++));
    } }, { highWaterMark: 0 });
    const [a, b] = teeForInspection(source).map(stream => stream.getReader());
    const values = await Promise.all([a!, b!].map(async reader => {
      const results = await Promise.all(Array.from({ length: 5 }, () => reader.read()));
      reader.releaseLock();
      return results.map(r => r.done ? "done" : r.value[0]);
    }));
    expect(values).toEqual([[0, 1, 2, 3, "done"], [0, 1, 2, 3, "done"]]);
    expect(source.locked).toBe(false);
  });

  test("source failure reaches both branches without retaining its reader", async () => {
    const failure = new Error("upstream failed");
    const source = new ReadableStream<Uint8Array>({ pull(c) { c.error(failure); } }, { highWaterMark: 0 });
    const [a, b] = teeForInspection(source).map(stream => stream.getReader());
    const results = await Promise.allSettled([a!.read(), b!.read()]);
    expect(results).toEqual([{ status: "rejected", reason: failure }, { status: "rejected", reason: failure }]);
    expect(source.locked).toBe(false);
    a!.releaseLock(); b!.releaseLock();
  });

  test("retains late terminal usage after more than 32 MiB of SSE delivery", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const block = encode('data: {"type":"response.output_text.delta","delta":"' + "x".repeat(32768) + '"}\n\n');
    const terminal = encode('data: {"type":"response.completed","response":{"id":"late","status":"completed","output":[],"usage":{"input_tokens":9,"output_tokens":4}}}\n\n');
    let i = 0;
    const source = new ReadableStream<Uint8Array>({ pull(c) {
      if (i++ < 1025) c.enqueue(block); else { c.enqueue(terminal); c.close(); }
    } }, { highWaterMark: 0 });
    const [client, inspection] = teeForInspection(source);
    const logCtx: RequestLogContext = { model: "fixture", provider: "openai" };
    let status: string | undefined;
    const inspected = new Promise<void>(resolve => {
      consumeForInspection(inspection, value => { status = value; }, undefined, resolve, logCtx);
    });
    expect(await drain(client)).toBe(1025 * block.byteLength + terminal.byteLength);
    await inspected;
    expect(status).toBe("completed");
    expect(logCtx.usage).toMatchObject({ inputTokens: 9, outputTokens: 4 });
    expect(source.locked).toBe(false);
  });
});
