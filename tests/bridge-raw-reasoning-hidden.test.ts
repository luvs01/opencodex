import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bridgeToResponsesSSE, buildResponseJSON } from "../src/bridge";
import {
  clearReasoningReplayCacheForTests,
  peekReasoningForCall,
} from "../src/responses/reasoning-replay-cache";
import type { AdapterEvent } from "../src/types";

async function* replay(events: AdapterEvent[]): AsyncGenerator<AdapterEvent> {
  for (const event of events) yield event;
}

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<{ event?: string; data: Record<string, unknown> }[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text.split("\n\n")
    .map(frame => frame.trim())
    .filter(frame => frame.length > 0 && frame !== "data: [DONE]")
    .map(frame => {
      const lines = frame.split("\n");
      const event = lines.find(line => line.startsWith("event: "))?.slice(7);
      const dataLine = lines.find(line => line.startsWith("data: "));
      return { event, data: JSON.parse(dataLine?.slice(6) ?? "{}") as Record<string, unknown> };
    });
}

const sseOpts = (hide: boolean) => ({ hideThinkingSummary: hide });

describe("hidden raw reasoning (hideThinkingSummary parity for reasoning_raw_delta)", () => {
  beforeEach(() => {
    clearReasoningReplayCacheForTests();
  });
  afterEach(() => {
    clearReasoningReplayCacheForTests();
  });

  test("streamed hidden: no reasoning output, tool calls untouched", async () => {
    const frames = await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "chain " },
      { type: "reasoning_raw_delta", text: "of thought" },
      { type: "tool_call_start", id: "call_1", name: "read_file" },
      { type: "tool_call_delta", arguments: "{\"path\":\"a.txt\"}" },
      { type: "tool_call_end" },
      { type: "done" },
    ]), "routed/model", undefined, undefined, undefined, undefined, undefined, sseOpts(true)));

    expect(frames.some(f => f.event === "response.reasoning_text.delta")).toBe(false);
    const completed = frames.find(f => f.event === "response.completed")?.data.response as Record<string, unknown>;
    const output = completed.output as Record<string, unknown>[];
    const reasoning = output.filter(o => o.type === "reasoning");
    expect(reasoning).toHaveLength(0);
    const fc = output.find(o => o.type === "function_call") as Record<string, unknown>;
    expect(fc).toMatchObject({ call_id: "call_1", name: "read_file" });
  });

  test("streamed visible (flag off): current raw shape unchanged", async () => {
    const frames = await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "visible raw" },
      { type: "done" },
    ]), "routed/model"));
    expect(frames.some(f => f.event === "response.reasoning_text.delta")).toBe(true);
    const completed = frames.find(f => f.event === "response.completed")?.data.response as Record<string, unknown>;
    const output = completed.output as Record<string, unknown>[];
    expect(output[0]).toMatchObject({
      type: "reasoning", summary: [],
      content: [{ type: "reasoning_text", text: "visible raw" }],
    });
  });

  test("streamed hidden: thrown upstream does not expose reasoning before response.failed", async () => {
    async function* throwing(): AsyncGenerator<AdapterEvent> {
      yield { type: "reasoning_raw_delta", text: "doomed thought" };
      throw new Error("upstream exploded");
    }
    const frames = await collectSse(bridgeToResponsesSSE(throwing(), "routed/model", undefined, undefined, undefined, undefined, undefined, sseOpts(true)));
    const failed = frames.find(f => f.event === "response.failed");
    expect(failed).toBeDefined();
    const added = frames.filter(f => f.event === "response.output_item.added")
      .map(f => f.data.item as Record<string, unknown>)
      .filter(i => i.type === "reasoning");
    expect(added).toHaveLength(0);
  });

  test("non-streaming hidden: no raw reasoning item is emitted", () => {
    const json = buildResponseJSON([
      { type: "reasoning_raw_delta", text: "quiet" },
      { type: "done" },
    ], "routed/model", { hideThinkingSummary: true });
    const output = (json as { output: Record<string, unknown>[] }).output;
    expect(output.find(o => o.type === "reasoning")).toBeUndefined();
  });

  test("non-streaming visible: raw shape unchanged", () => {
    const json = buildResponseJSON([
      { type: "reasoning_raw_delta", text: "loud" },
      { type: "done" },
    ], "routed/model", {});
    const output = (json as { output: Record<string, unknown>[] }).output;
    expect(output.find(o => o.type === "reasoning")).toMatchObject({
      content: [{ type: "reasoning_text", text: "loud" }],
    });
  });

  test("streamed hidden: raw reasoning is recorded in the replay cache for the following tool call", async () => {
    await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "chain " },
      { type: "reasoning_raw_delta", text: "of thought" },
      { type: "tool_call_start", id: "call_1", name: "read_file" },
      { type: "tool_call_delta", arguments: "{\"path\":\"a.txt\"}" },
      { type: "tool_call_end" },
      { type: "done" },
    ]), "routed/model", undefined, undefined, undefined, undefined, undefined, sseOpts(true)));
    expect(peekReasoningForCall("call_1")).toBe("chain of thought");
    expect(peekReasoningForCall("call_other")).toBeUndefined();
  });

  test("non-streaming hidden: raw reasoning is recorded for the following tool call", () => {
    buildResponseJSON([
      { type: "reasoning_raw_delta", text: "quiet" },
      { type: "tool_call_start", id: "call_2", name: "read_file" },
      { type: "tool_call_delta", arguments: "{}" },
      { type: "tool_call_end" },
      { type: "done" },
    ], "routed/model", { hideThinkingSummary: true });
    expect(peekReasoningForCall("call_2")).toBe("quiet");
  });

  test("raw reasoning consumed by a text turn is NOT cached for a later tool call", async () => {
    await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "for the text" },
      { type: "text_delta", text: "answer" },
      { type: "tool_call_start", id: "call_later", name: "read_file" },
      { type: "tool_call_delta", arguments: "{}" },
      { type: "tool_call_end" },
      { type: "done" },
    ]), "routed/model", undefined, undefined, undefined, undefined, undefined, sseOpts(true)));
    expect(peekReasoningForCall("call_later")).toBeUndefined();
  });

  test("hidden thinking_delta clears raw reasoning pending for a later tool call", async () => {
    await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "stale raw" },
      { type: "thinking_delta", thinking: "signed thinking follows" },
      { type: "tool_call_start", id: "call_after_thinking", name: "read_file" },
      { type: "tool_call_delta", arguments: "{}" },
      { type: "tool_call_end" },
      { type: "done" },
    ]), "routed/model", undefined, undefined, undefined, undefined, undefined, sseOpts(true)));
    expect(peekReasoningForCall("call_after_thinking")).toBeUndefined();
  });
});
