import { beforeEach, afterEach, expect, test } from "bun:test";
import { configSchema } from "../../src/config/schema/config-schema";
import { getRequestLogEntries } from "../../src/server/request-log";
import { MAX_ACTIVE_TURNS, tryAdmitTurn } from "../../src/server/lifecycle";
import { ack, begin, call, cleanup, client, complete, configuration, initial, injection, InjectionSocket, network, setup, until } from "../helpers/native-injection";

beforeEach(setup); afterEach(cleanup);

test("native injection configuration defaults off and malformed values cannot enable it", () => {
  expect(configSchema.parse(configuration()).codexNativeInjection).toBe(true);
  expect(configSchema.parse({ ...configuration(), codexNativeInjection: "true" }).codexNativeInjection).toBe(false);
  expect(configSchema.parse({ ...configuration(), codexNativeInjection: undefined }).codexNativeInjection).not.toBe(true);
});

test.each(["response.cancel", "response.future", "session.update"])("unknown %s returns an error without cancelling the active response", async type => {
  const c = await begin();
  c.send({ type, input: "not echoed" });
  expect(c.sent.at(-1)?.error.code).toBe("unsupported_event");
  expect(JSON.stringify(c.sent.at(-1))).not.toContain("not echoed");
  expect(c.socket.frames).toHaveLength(1);
  expect(c.socket.readyState).toBe(1);
  complete(c.socket); await until(() => !c.ws.data.nativeSteering);
});

test("invalid JSON and nontyped envelopes are rejected; processed ACK remains a no-op", () => {
  const c = client();
  c.handler.message(c.ws, "{broken");
  for (const raw of ["null", "[]", "1", "{}", '{"type":7}']) c.handler.message(c.ws, raw);
  expect(c.sent).toHaveLength(6);
  expect(c.sent[0].error.code).toBe("invalid_json");
  expect(c.sent.slice(1).every(f => f.error.code === "invalid_event")).toBe(true);
  c.send({ type: "response.processed" }); expect(c.sent).toHaveLength(6);
  expect(InjectionSocket.all).toHaveLength(0);
});

test("real native pipeline injects a saved result and waits for late ACK after completion", async () => {
  const c = await begin();
  const tool = call(c.socket, "call-1", 0, "/root/sub");
  c.send(injection(c.id));
  expect(c.socket.frames[1]).toEqual(injection(c.id));
  expect(c.socket.options.headers["openai-beta"]).toContain("responses_multi_agent=v1");
  complete(c.socket, [tool]);
  await until(() => c.sent.some(f => f.type === "response.completed"));
  expect(c.ws.data.nativeSteering).toBeDefined(); expect(c.socket.readyState).toBe(1);
  ack(c.socket, 8); await until(() => !c.ws.data.nativeSteering);
  expect(c.sent.at(-1)).toMatchObject({ type: "response.inject.created", sequence_number: 8 });
  expect(c.sent.find(f => f.type === "response.output_item.done")?.item.agent).toEqual({ agent_name: "/root/sub" });
  expect(c.socket.frames).toHaveLength(2); expect(network.fallbackCalls).toBe(0);
  expect(getRequestLogEntries().at(-1)?.usage).toMatchObject({ inputTokens: 20, outputTokens: 5 });
});

test("FIFO dispatch keeps anonymous confirmations correlated and snapshots queued input", async () => {
  const c = await begin(); call(c.socket); call(c.socket, "call-2", 1);
  c.send(injection(c.id)); const second = injection(c.id, "call-2", "second"); c.send(second);
  second.input[0].output = "mutated";
  expect(c.socket.frames).toHaveLength(2);
  c.send({ ...initial, input: "do not replace pending" });
  expect(c.sent.at(-1)?.error.code).toBe("injection_pending");
  ack(c.socket); await until(() => c.socket.frames.length === 3);
  expect(c.socket.frames[2].input[0].output).toBe("second");
  ack(c.socket, 2); complete(c.socket); await until(() => !c.ws.data.nativeSteering);
  expect(InjectionSocket.all).toHaveLength(1);
});

test("failed injection is relayed only to its owner and excluded from logs and next-turn replay", async () => {
  const c = await begin(); const tool = call(c.socket);
  const packet = injection(c.id, "call-1", "PRIVATE-INJECT-RESULT"); c.send(packet); complete(c.socket, [tool]);
  c.socket.emit({ type: "response.inject.failed", response_id: c.id, sequence_number: 4, input: packet.input,
    error: { code: "response_already_completed", message: "PRIVATE-INJECT-ERROR" } });
  await until(() => !c.ws.data.nativeSteering);
  expect(c.sent.at(-1)?.input).toEqual(packet.input);
  expect(JSON.stringify(getRequestLogEntries())).not.toContain("PRIVATE-INJECT");
  c.send({ ...initial, previous_response_id: c.id, input: "next turn" });
  await until(() => InjectionSocket.all.length === 2 && InjectionSocket.all[1].frames.length > 0);
  expect(JSON.stringify(InjectionSocket.all[1].frames[0].input)).not.toContain("PRIVATE-INJECT");
  expect(JSON.stringify(InjectionSocket.all[1].frames[0].input)).toContain("call-1");
});

test("confirmed injections enter next-turn replay exactly once after their function call", async () => {
  const c = await begin(); const tool = call(c.socket);
  c.send(injection(c.id)); ack(c.socket); complete(c.socket, [tool]);
  await until(() => !c.ws.data.nativeSteering);
  c.send({ ...initial, previous_response_id: c.id, input: "next" });
  await until(() => InjectionSocket.all.length === 2 && InjectionSocket.all[1].frames.length > 0);
  const items = InjectionSocket.all[1].frames[0].input;
  const index = items.findIndex((i: any) => i.type === "function_call" && i.call_id === "call-1");
  expect(index).toBeGreaterThanOrEqual(0);
  expect(items[index + 1]).toMatchObject({ type: "function_call_output", call_id: "call-1", output: "saved output" });
  expect(items.filter((i: any) => i.type === "function_call_output")).toHaveLength(1);
});

test("late result after root completion reaches the same socket instead of disappearing", async () => {
  const c = await begin(); const tool = call(c.socket); complete(c.socket, [tool]);
  await until(() => c.sent.some(f => f.type === "response.completed"));
  c.send(injection(c.id)); expect(c.socket.frames).toHaveLength(2);
  c.socket.emit({ type: "response.inject.failed", response_id: c.id, sequence_number: 5, input: injection(c.id).input, error: { code: "response_already_completed", message: "completed" } });
  await until(() => !c.ws.data.nativeSteering);
  expect(c.sent.at(-1)?.type).toBe("response.inject.failed");
});

test("disabled, ordinary and unattached transports explicitly reject injection", async () => {
  const cold = client(); cold.send(injection("unknown")); expect(cold.sent.at(-1)?.error.code).toBe("injection_not_supported");
  for (const [config, fields] of [[{ ...configuration(), codexNativeInjection: false }, {}], [configuration(), { multi_agent: undefined }]] as const) {
    const c = await begin(config, String(InjectionSocket.all.length), fields);
    c.send(injection(c.id)); expect(c.sent.at(-1)?.error.code).toBe("injection_not_supported"); complete(c.socket);
  }
});

test("multiplexed injection mode is explicitly refused, not routed across lanes", () => {
  const c = client(); c.send({ ...initial, stream_id: "lane" });
  expect(c.sent.at(-1)?.type).toBe("error"); expect(InjectionSocket.all).toHaveLength(0);
});

test("warmup and failed turn admission do not retain an injection owner", () => {
  const c = client(); c.send({ ...initial, generate: false }); expect(c.ws.data.nativeSteering).toBeUndefined();
  const leases = Array.from({ length: MAX_ACTIVE_TURNS }, () => tryAdmitTurn());
  try { c.send(initial); expect(c.sent.at(-1)?.status).toBe(503); expect(c.ws.data.nativeSteering).toBeUndefined(); }
  finally { for (const lease of leases) lease?.release(); }
});

test("wrong response, undeclared call, privileged input, duplicate and steering are rejected without extra sends", async () => {
  const c = await begin(); call(c.socket);
  for (const frame of [injection("foreign"), injection(c.id, "foreign"), { type: "response.inject", response_id: c.id, input: [{ role: "system", content: "bad" }] }, { ...injection(c.id), model: "other" }]) {
    c.send(frame); expect(c.sent.at(-1)?.type).toBe("error");
  }
  expect(c.socket.frames).toHaveLength(1);
  c.send(injection(c.id)); c.send(injection(c.id)); expect(c.sent.at(-1)?.error.code).toBe("duplicate_injection");
  c.send({ type: "response.steer", previous_response_id: c.id, input: "change" }); expect(c.sent.at(-1)?.error.code).toBe("steering_not_supported");
  expect(c.socket.frames).toHaveLength(2);
  ack(c.socket); complete(c.socket); await until(() => !c.ws.data.nativeSteering);
});

test("two downstream owners cannot inject each other's results", async () => {
  const a = await begin(configuration(), "a"); const b = await begin(configuration(), "b"); call(a.socket); call(b.socket);
  a.send(injection(b.id)); expect(a.sent.at(-1)?.error.code).toBe("response_not_active");
  expect(a.socket.frames).toHaveLength(1); expect(b.socket.frames).toHaveLength(1);
});

test("official API injection requires upstreamWebsocket opt-in and preserves API credential and beta", async () => {
  const config = configuration(); config.defaultProvider = "openai-apikey"; config.providers = { "openai-apikey": { adapter: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "fixture-api-key", upstreamWebsocket: true } };
  const c = await begin(config, "caller-credential", { model: "openai-apikey/gpt-5.5" }); call(c.socket); c.send(injection(c.id));
  expect(c.socket.url).toBe("wss://api.openai.com/v1/responses");
  expect(c.socket.options.headers.authorization).toBe("Bearer fixture-api-key");
  expect(c.socket.options.headers["openai-beta"]).toContain("responses_multi_agent=v1");
  expect(c.socket.frames[1]).toEqual(injection(c.id)); ack(c.socket); complete(c.socket); await until(() => !c.ws.data.nativeSteering);
});

test("an opted-in non-OpenAI gateway still cannot receive native injections", async () => {
  const config = configuration(); config.defaultProvider = "test-gateway"; config.providers = { "test-gateway": { adapter: "openai-responses", baseUrl: "https://gateway.invalid/v1", apiKey: "fixture", upstreamWebsocket: true } };
  const c = await begin(config, "gateway", { model: "test-gateway/test-model" }); c.send(injection(c.id));
  expect(c.sent.at(-1)?.error.code).toBe("injection_not_supported"); expect(c.socket.frames).toHaveLength(1); complete(c.socket);
});


test("missing explicit multi-agent beta is refused before opening a transport", () => {
  const c = client(configuration(), "test", "responses_websockets=2026-02-06"); c.send(initial);
  expect(c.sent.at(-1)?.error.code).toBe("injection_not_supported"); expect(InjectionSocket.all).toHaveLength(0);
});

test("HTTP fallback can complete normally but never pretends to deliver an injection", async () => {
  const config = configuration(); config.defaultProvider = "openai-apikey";
  config.providers = { "openai-apikey": { adapter: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKey: "fixture", upstreamWebsocket: false } };
  let feed!: ReadableStreamDefaultController<Uint8Array>;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      feed = controller;
      controller.enqueue(new TextEncoder().encode('event: response.created\ndata: {"type":"response.created","response":{"id":"http-root","output":[]}}\n\n'));
    } }), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const c = client(config); c.send({ ...initial, model: "openai-apikey/gpt-5.5" });
  await until(() => c.sent.some(f => f.type === "response.created"));
  c.send(injection("http-root")); expect(c.sent.at(-1)?.error.code).toBe("injection_not_supported");
  expect(calls).toBe(1); expect(InjectionSocket.all).toHaveLength(0);
  feed.enqueue(new TextEncoder().encode('event: response.completed\ndata: {"type":"response.completed","response":{"id":"http-root","status":"completed","output":[]}}\n\n')); feed.close();
  await until(() => !c.ws.data.nativeSteering);
});

test("unknown or mismatched upstream ACK closes the owner without retry or leaking the ACK", async () => {
  const c = await begin(); call(c.socket); c.send(injection(c.id));
  c.socket.emit({ type: "response.inject.created", response_id: "foreign", sequence_number: 1 });
  await until(() => !c.ws.data.nativeSteering);
  expect(c.sent.some(f => f.type === "response.inject.created")).toBe(false);
  expect(c.socket.readyState).toBe(3); expect(c.socket.frames).toHaveLength(2); expect(network.fallbackCalls).toBe(0);
});

test("disconnect with unacknowledged results never falls back or resends queued packets", async () => {
  const c = await begin(); call(c.socket); call(c.socket, "call-2", 1);
  c.send(injection(c.id)); c.send(injection(c.id, "call-2")); c.socket.close();
  await until(() => !c.ws.data.nativeSteering);
  expect(c.socket.frames).toHaveLength(2); expect(network.fallbackCalls).toBe(0); expect(InjectionSocket.all).toHaveLength(1);
});


test("generic injection transport errors are delivered but their echoed result is not a log sample", async () => {
  const c = await begin(); call(c.socket); c.send(injection(c.id, "call-1", "SECRET-SAVED-RESULT"));
  c.socket.emit({ type: "error", error: { type: "invalid_request_error", message: "SECRET-SAVED-RESULT" } });
  await until(() => !c.ws.data.nativeSteering);
  expect(c.sent.some(f => f.type === "error" && f.error.message === "SECRET-SAVED-RESULT")).toBe(true);
  expect(JSON.stringify(getRequestLogEntries())).not.toContain("SECRET-SAVED-RESULT");
});
