import { expect, test } from "bun:test";
import { createOpenAIChatAdapter } from "../../../src/adapters/openai-chat";
import { SerializedToolCallContentBuffer } from "../../../src/adapters/openai-chat/serialized-tool-call-content";
import { createTestTranslatorBudget } from "../../helpers/translator-budget";

const provider = { adapter: "openai-chat", baseUrl: "https://openrouter.ai/api/v1", apiKey: "key" } as const;

test("buffered Chat responses reconcile matching serialized and structured tool calls", async () => {
  const script = "text('ok');";
  const content = `Running it.\n<tool_call><function=exec>${script}\n</parameter></function></tool_call>`;
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content,
        tool_calls: [{
          id: "call_exec",
          function: { name: "exec", arguments: script + JSON.stringify({ input: script }) },
        }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.filter(event => event.type === "text_delta")).toEqual([
    { type: "text_delta", text: "Running it.\n" },
  ]);
  expect(events.find(event => event.type === "tool_call_delta")).toEqual({
    type: "tool_call_delta",
    arguments: JSON.stringify({ input: script }),
  });
});

test("buffered Chat responses preserve serialized markup for a different function", async () => {
  const content = "<tool_call><function=other>literal example</function></tool_call>";
  const events = await createOpenAIChatAdapter(provider).parseResponse!(Response.json({
    choices: [{
      message: {
        content,
        tool_calls: [{ id: "call_exec", function: { name: "exec", arguments: "{}" } }],
      },
      finish_reason: "tool_calls",
    }],
  }), createTestTranslatorBudget());

  expect(events.find(event => event.type === "text_delta")).toEqual({ type: "text_delta", text: content });
});

test("an open serialized block charges only its appended bytes", () => {
  const open = "<tool_call><function=exec>";
  const body = "x".repeat(open.length);
  // Rebuilding the whole buffer would reserve the new total beside the retained
  // text, so this exact budget only admits the append when it charges the delta.
  const budget = createTestTranslatorBudget({ maxTurnBytes: open.length + body.length });
  const buffer = new SerializedToolCallContentBuffer(budget);

  expect(buffer.ingest(open)).toBe("");
  expect(buffer.ingest(body)).toBe("");
  expect(buffer.current()).toBe(open + body);
  expect(budget.snapshot()).toMatchObject({ currentBytes: open.length + body.length, overflows: 0 });

  expect(buffer.flush([])).toBe(open + body);
  expect(budget.snapshot()).toMatchObject({ currentBytes: 0, overflows: 0 });
});

test("malformed whitespace-heavy serialized calls are scanned without event-loop delay", () => {
  // Measured in CPU time rather than elapsed wall time: `performance.now()` counts OS
  // descheduling, VM pauses and GC, so a loaded CI runner can blow any wall-clock budget
  // while the code under test did nothing wrong. The bound stays a tripwire far above the
  // scan's real cost — only a return to super-linear work can cross it.
  const content = "<tool_call><function=exec>" + " ".repeat(80_000);
  const structured = [{ names: new Set(["exec"]), argumentsText: '{"input":"ok"}' }];
  const build = () => {
    const buffer = new SerializedToolCallContentBuffer(createTestTranslatorBudget());
    expect(buffer.ingest(content)).toBe("");
    return buffer;
  };
  build().flush(structured); // Warm up so first-call JIT and allocation land outside the measurement.

  const buffer = build();
  const before = process.cpuUsage();
  expect(buffer.flush(structured)).toBe(content);
  const spent = process.cpuUsage(before);
  expect((spent.user + spent.system) / 1000).toBeLessThan(500);
});
