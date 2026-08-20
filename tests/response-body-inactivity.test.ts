import { describe, expect, test } from "bun:test";
import { guardResponseBodyInactivity } from "../src/lib/response-body-inactivity";

describe("upstream response body inactivity", () => {
  test("guards both passthrough and adapter response bodies after headers", async () => {
    const core = await Bun.file(new URL("../src/server/responses/core.ts", import.meta.url)).text();
    expect(core).toContain("guardResponseBodyInactivity(upstreamResponse, upstream, bodyInactivityMs)");
    expect(core).toContain("guardResponseBodyInactivity(upstreamResponse, upstream, stallTimeoutMs)");
  });

  test("aborts a headers-only upstream", async () => {
    const upstream = new AbortController();
    const response = guardResponseBodyInactivity(new Response(
      new ReadableStream<Uint8Array>({ pull() { return new Promise<void>(() => {}); } }),
    ), upstream, 20);

    await expect(response.text()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(upstream.signal.aborted).toBe(true);
    expect(upstream.signal.reason).toMatchObject({ name: "TimeoutError" });
  });

  test("resets on bytes and ignores downstream backpressure", async () => {
    const encoder = new TextEncoder();
    const upstream = new AbortController();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const guarded = guardResponseBodyInactivity(new Response(new ReadableStream({
      start(value) { controller = value; },
    })), upstream, 30);
    const reader = guarded.body!.getReader();

    controller.enqueue(encoder.encode("one"));
    controller.enqueue(encoder.encode("two"));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("one");
    await Bun.sleep(45);
    expect(upstream.signal.aborted).toBe(false);

    expect(new TextDecoder().decode((await reader.read()).value)).toBe("two");
    controller.close();
    expect((await reader.read()).done).toBe(true);
    expect(upstream.signal.aborted).toBe(false);
  });
});
