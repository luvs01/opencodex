import { expect, test } from "bun:test";
import { NativeInjectionChannel, MAX_NATIVE_INJECTIONS, MAX_NATIVE_INJECTION_BYTES, type NativeInjectionScheduler } from "../../src/server/responses/native-injection";
import { NativeInjectionReplay } from "../../src/server/responses/native-injection-replay";
import { MAX_NATIVE_STEERING_REPLAY_BYTES } from "../../src/server/responses/native-steering-replay";
import { supportsNativeControlRoute } from "../../src/server/responses/native-response-control";
import { initial, injection } from "../helpers/native-injection";

type Frame = Record<string, any>;
function harness(send?: (f: Frame) => void) {
  const scheduled: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  const scheduler: NativeInjectionScheduler = (fn, ms) => { const task = { fn, ms, cancelled: false }; scheduled.push(task); return () => { task.cancelled = true; }; };
  const c = new NativeInjectionChannel(initial, 300_000, 90_000, scheduler);
  const sent: Frame[] = [], failures: Error[] = [];
  const detach = c.attach(f => { sent.push(f); send?.(f); }, e => failures.push(e));
  c.observe({ type: "response.created", response: { id: "root" } });
  const advertise = (id: string, index = 0, type = "function_call") => {
    const item = { type, id: `item-${id}`, call_id: id, name: "lookup", arguments: "{}" };
    c.observe({ type: "response.output_item.added", response_id: "root", output_index: index, item });
    c.observe({ type: "response.output_item.done", response_id: "root", output_index: index, item });
    return item;
  };
  const ack = (sequence_number = 1, fields: Frame = {}) => c.observe({ type: "response.inject.created", response_id: "root", sequence_number, ...fields });
  return { c, sent, failures, scheduled, detach, advertise, ack };
}

test("absolute injection ACK deadline is not extended by output or usage progress", () => {
  const h = harness(); h.advertise("a"); h.c.inject(injection("root", "a"));
  const deadline = h.scheduled.find(t => t.ms === 90_000)!;
  h.c.observe({ type: "response.in_progress", response: { id: "root" } });
  expect(deadline.cancelled).toBe(false); deadline.fn(); deadline.fn();
  expect(h.failures).toHaveLength(1); expect(h.c.ended).toBe(true); expect(h.sent).toHaveLength(1); h.detach();
  expect(h.scheduled.every(t => t.cancelled)).toBe(true);
});

test("synchronous send failure is terminal and never resubmits or releases queued work", async () => {
  const h = harness(() => { throw new Error("private transport detail"); }); h.advertise("a");
  h.c.inject(injection("root", "a"));
  expect(h.c.ended).toBe(true); expect(h.sent).toHaveLength(1); expect(h.failures).toHaveLength(1);
  expect(h.failures[0].message).not.toContain("private transport detail");
  expect(() => h.c.inject(injection("root", "a"))).toThrow(); await Promise.resolve(); expect(h.sent).toHaveLength(1); h.detach();
});

test("detach cancels timers and an already-scheduled FIFO dispatch", async () => {
  const h = harness(); h.advertise("a"); h.advertise("b", 1);
  h.c.inject(injection("root", "a")); h.c.inject(injection("root", "b"));
  h.ack(); h.detach(); await Promise.resolve(); expect(h.sent).toHaveLength(1);
  expect(h.scheduled.every(t => t.cancelled)).toBe(true);
});

test("reentrant synchronous ACKs preserve FIFO order without recursive sends", async () => {
  let depth = 0, maxDepth = 0, sequence = 0;
  let h: ReturnType<typeof harness>;
  h = harness(() => { depth++; maxDepth = Math.max(depth, maxDepth); h.ack(++sequence); depth--; });
  h.advertise("a"); h.advertise("b", 1); h.c.inject(injection("root", "a")); h.c.inject(injection("root", "b"));
  await Promise.resolve(); expect(maxDepth).toBe(1); expect(h.sent.map(f => f.input[0].call_id)).toEqual(["a", "b"]); h.detach();
});

test("queue count and byte limits reject before reserving call IDs or sending", async () => {
  const h = harness();
  for (let i = 0; i <= MAX_NATIVE_INJECTIONS; i++) h.advertise(`c${i}`, i);
  for (let i = 0; i < MAX_NATIVE_INJECTIONS; i++) h.c.inject(injection("root", `c${i}`));
  expect(() => h.c.inject(injection("root", `c${MAX_NATIVE_INJECTIONS}`))).toThrow("limit");
  expect(h.sent).toHaveLength(1);
  h.ack(); await Promise.resolve();
  expect(() => h.c.inject(injection("root", `c${MAX_NATIVE_INJECTIONS}`))).not.toThrow(); h.detach();
  const b = harness(); b.advertise("a");
  expect(() => b.c.inject(injection("root", "a", "x".repeat(MAX_NATIVE_INJECTION_BYTES)))).toThrow("limit");
  expect(b.sent).toHaveLength(0); expect(() => b.c.inject(injection("root", "a"))).not.toThrow(); b.detach();
});

test("server-owned multi-agent operations cannot authorize client tool-result injection", () => {
  const h = harness(); h.advertise("server-task", 0, "multi_agent_call");
  expect(() => h.c.inject(injection("root", "server-task"))).toThrow("client-owned"); h.detach();
});

test.each([
  { response_id: "other" }, { stream_id: "other" }, { sequence_number: -1 },
  { sequence_number: 1.5 }, { sequence_number: undefined }, { type: "response.inject.future" },
])("forged or unsupported ACK is rejected: %j", fields => {
  const h = harness(); h.advertise("a"); h.c.inject(injection("root", "a"));
  expect(() => h.ack(1, fields)).toThrow(); h.detach();
});

test("duplicate ACK sequence cannot acknowledge a later packet", async () => {
  const h = harness(); h.advertise("a"); h.advertise("b", 1); h.c.inject(injection("root", "a")); h.c.inject(injection("root", "b"));
  h.ack(7); await Promise.resolve(); expect(() => h.ack(7)).toThrow(); h.detach();
});

test.each(["different output", "different call"])("failed ACK must echo the pending input: %s", change => {
  const h = harness(); h.advertise("a"); h.c.inject(injection("root", "a"));
  const input = injection("root", change === "different call" ? "other" : "a", change === "different output" ? "other" : "saved output").input;
  expect(() => h.ack(1, { type: "response.inject.failed", input, error: { code: "response_already_completed" } })).toThrow(); h.detach();
});

test("an undeclared function name or ambiguous call identity is rejected upstream", () => {
  const h = harness();
  const bad = { type: "function_call", id: "bad", call_id: "a", name: "not-declared" };
  h.c.observe({ type: "response.output_item.added", output_index: 0, item: bad });
  expect(() => h.c.observe({ type: "response.output_item.done", output_index: 0, item: bad })).toThrow("undeclared"); h.detach();
});

test("controls never grant public API routing to lookalike or overridden endpoints", () => {
  const h = harness();
  for (const provider of [
    { adapter: "openai-responses", baseUrl: "https://api.openai.com.evil.invalid/v1", upstreamWebsocket: true },
    { adapter: "openai-responses", baseUrl: "https://api.openai.com/v1", responsesPath: "/wrong", upstreamWebsocket: true },
    { adapter: "openai-responses", baseUrl: "https://api.openai.com/v1", upstreamWebsocket: false },
  ]) expect(supportsNativeControlRoute(provider, h.c)).toBe(false);
  h.detach();
});

test("replay waits for all confirmations and retains opaque agent output unchanged", () => {
  let saved: Frame | undefined;
  const r = new NativeInjectionReplay("initial", (input, response) => { saved = { input, response }; });
  const tool = { type: "function_call", id: "i", call_id: "a", name: "lookup", agent: { agent_name: "/root/child" } };
  const opaque = { type: "agent_message", id: "m", encrypted_content: "opaque-test", agent: { agent_name: "/root/child" } };
  r.submitted(injection("root", "a"));
  r.observe({ type: "response.completed", response: { id: "root", status: "completed", output: [tool, opaque] } });
  r.finish(); expect(saved).toBeUndefined();
  r.observe({ type: "response.inject.created" }); r.finish();
  expect(saved!.response.output).toEqual([tool, injection("root", "a").input[0], opaque]);
  r.finish(); r.dispose();
});

test("unacknowledged, rejected and rolled-back input never enter persisted replay", () => {
  let output: unknown[] | undefined;
  const r = new NativeInjectionReplay([], (_, response) => { output = response.output as unknown[]; });
  const rollback = r.submitted(injection("root", "a", "rollback")); rollback();
  r.submitted(injection("root", "b", "rejected"));
  r.observe({ type: "response.completed", response: { id: "root", output: [] } });
  r.finish(); expect(output).toBeUndefined();
  r.observe({ type: "response.inject.failed" }); r.finish(); expect(output).toEqual([]); r.dispose();
});

test("replay refuses missing or conflicting acknowledged call/result state instead of truncating", () => {
  for (const output of [[], [{ type: "function_call_output", call_id: "a", output: "other" }]]) {
    const r = new NativeInjectionReplay([], () => { throw new Error("must not persist"); });
    r.submitted(injection("root", "a")); r.observe({ type: "response.inject.created" });
    r.observe({ type: "response.completed", response: { id: "root", output } });
    expect(() => r.finish()).toThrow(); r.dispose();
  }
});

test("replay does not duplicate a result already present in the authoritative terminal", () => {
  let count = 0;
  const tool = { type: "function_call", call_id: "a" };
  const result = injection("root", "a").input[0];
  const r = new NativeInjectionReplay([], (_, response) => { count++; expect(response.output).toEqual([tool, result]); });
  r.submitted(injection("root", "a")); r.observe({ type: "response.inject.created" });
  r.observe({ type: "response.completed", response: { id: "root", output: [tool, result] } });
  r.finish(); r.finish(); expect(count).toBe(1); r.dispose();
});

test("replay history budget rejects before retaining an oversized initial prefix", () => {
  expect(() => new NativeInjectionReplay("x".repeat(MAX_NATIVE_STEERING_REPLAY_BYTES), () => {})).toThrow("budget");
});

test("queued injection rechecks the captured credential guard at its physical send boundary", async () => {
  const { setup, cleanup, InjectionSocket, call, ack, until, network } = await import("../helpers/native-injection");
  const { codexWsUpstreamFetch } = await import("../../src/server/responses/ws-upstream");
  setup();
  try {
    const control = new NativeInjectionChannel(initial);
    let allowed = true, checks = 0;
    const guard = () => { checks++; if (!allowed) throw new Error("revoked fixture authority"); };
    const response = await codexWsUpstreamFetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST", headers: { authorization: "Bearer fixture", "openai-beta": "responses_multi_agent=v1" },
      body: JSON.stringify({ ...initial, stream: true }),
    }, globalThis.fetch, "1.4.0", undefined, guard, control);
    const read = response.text().then(() => "complete", () => "failed");
    const socket = InjectionSocket.all[0]; call(socket); call(socket, "call-2", 1);
    control.inject(injection(socket.root)); control.inject(injection(socket.root, "call-2"));
    allowed = false; ack(socket);
    await until(() => socket.readyState === 3);
    expect(await read).toBe("failed"); expect(checks).toBeGreaterThanOrEqual(4);
    expect(socket.frames).toHaveLength(2); expect(network.fallbackCalls).toBe(0);
  } finally { cleanup(); }
});
