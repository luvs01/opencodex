import { expect } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { OcxConfig } from "../../src/types";
import type { ServeOptionsContext } from "../../src/server/index/shared";
import { createWebsocketHandler } from "../../src/server/index/websocket-handler";
import type { WsData } from "../../src/server/ws-bridge";
import { clearRequestLogsForTests } from "../../src/server/request-log";
import { runOptionalShutdownHooks } from "../../src/lib/optional-shutdown-hooks";

export type Frame = Record<string, any>;
const realSocket = globalThis.WebSocket, realFetch = globalThis.fetch;
const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
let savedProxy: Record<string, string | undefined>;
export const network = { fallbackCalls: 0 };
export class InjectionSocket extends EventTarget {
  static OPEN = 1;
  static all: InjectionSocket[] = [];
  readyState = 0;
  frames: Frame[] = [];
  readonly root = `injection-${InjectionSocket.all.length}`;
  constructor(readonly url: string, readonly options: { headers: Record<string, string> }) {
    super(); InjectionSocket.all.push(this);
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
  }
  send(text: string): void {
    this.frames.push(JSON.parse(text));
    if (this.frames.length === 1) queueMicrotask(() => this.emit({ type: "response.created", response: { id: this.root, status: "in_progress", output: [] } }));
  }
  emit(frame: Frame): void { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) })); }
  close(): void { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event("close")); }
}
export const configuration = (): OcxConfig => ({ port: 0, defaultProvider: "openai", websockets: true, codexNativeInjection: true,
  providers: { openai: { adapter: "openai-responses", baseUrl: "https://chatgpt.com/backend-api/codex", authMode: "forward", codexAccountMode: "direct" } },
} as OcxConfig);
export const initial = { type: "response.create", model: "gpt-5.5", input: "initial", multi_agent: { enabled: true }, tools: [{ type: "function", name: "lookup", parameters: { type: "object", properties: {} } }] };
export function setup(): void {
  network.fallbackCalls = 0;
  savedProxy = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  globalThis.WebSocket = InjectionSocket as unknown as typeof WebSocket;
  globalThis.fetch = (async () => { network.fallbackCalls++; throw new Error("Live network disabled in injection fixture"); }) as typeof fetch;
  clearRequestLogsForTests();
}
export function cleanup(): void {
  for (const socket of InjectionSocket.all) socket.close();
  InjectionSocket.all = []; runOptionalShutdownHooks();
  globalThis.WebSocket = realSocket; globalThis.fetch = realFetch;
  for (const key of proxyKeys) { delete process.env[key]; if (savedProxy[key] !== undefined) process.env[key] = savedProxy[key]; }
}
/** Yield event-loop turns, not wall-clock sleeps; every wait follows an explicit fixture event. */
export async function until(condition: () => boolean): Promise<void> {
  const deadline = performance.now() + 4000;
  while (performance.now() < deadline) { if (condition()) return; await new Promise<void>(resolve => setImmediate(resolve)); }
  throw new Error("Injection fixture did not reach the expected state");
}
export function client(config = configuration(), credential = "test", beta = "responses_multi_agent=v1") {
  const handler = createWebsocketHandler({ config, deps: {} } as ServeOptionsContext);
  const sent: Frame[] = [];
  const ws = { readyState: 1, data: { headers: new Headers({ authorization: `Bearer ${credential}`, "thread-id": `inject-${credential}`, session_id: `inject-${credential}`, "openai-beta": beta }) } as WsData,
    send: (text: string) => { sent.push(JSON.parse(text)); return 1; }, close() { handler.close(ws); },
  } as unknown as ServerWebSocket<WsData>;
  const send = (frame: Frame) => handler.message(ws, JSON.stringify(frame));
  return { handler, ws, sent, send };
}
export async function begin(config = configuration(), credential = "test", fields: Frame = {}) {
  const c = client(config, credential);
  c.send({ ...initial, ...fields });
  await until(() => c.sent.some(frame => frame.type === "response.created"));
  const socket = InjectionSocket.all.at(-1)!;
  expect(socket).toBeDefined();
  return { ...c, socket, id: socket.root };
}
export function call(socket: InjectionSocket, id = "call-1", index = 0, agent?: string) {
  const item = { type: "function_call", id: `item-${id}`, call_id: id, name: "lookup", arguments: "{}", ...(agent ? { agent: { agent_name: agent } } : {}) };
  socket.emit({ type: "response.output_item.added", response_id: socket.root, output_index: index, item });
  socket.emit({ type: "response.output_item.done", response_id: socket.root, output_index: index, item });
  return item;
}
export const injection = (response_id: string, call_id = "call-1", output = "saved output") => ({ type: "response.inject", response_id, input: [{ type: "function_call_output", call_id, output }] });
export function ack(socket: InjectionSocket, sequence_number = 1): void { socket.emit({ type: "response.inject.created", response_id: socket.root, sequence_number }); }
export function complete(socket: InjectionSocket, output: unknown[] = []): void { socket.emit({ type: "response.completed", response: { id: socket.root, status: "completed", output, usage: { input_tokens: 20, output_tokens: 5 } } }); }
