import { CODEX_WS_ID_MAX_BYTES, CodexWsCorrelation } from "./codex-ws-correlation";
import { codexWsCreateFrameExceedsLimit } from "./codex-ws-wire";
import { NativeSteeringError } from "./native-steering";
import type { NativeSteeringReplayObserver } from "./native-steering-replay";
import type { NativeResponseControl } from "./native-response-control";

export const NATIVE_INJECTION_ACK_MS = 90_000;
export const MAX_NATIVE_INJECTIONS = 32;
export const MAX_NATIVE_INJECTION_BYTES = 8 * 1024 * 1024;
const MAX_CALLS = 1024;
type Frame = Record<string, unknown>;
type Packet = { frame: Frame; bytes: number };
export type NativeInjectionScheduler = (callback: () => void, ms: number) => () => void;
/** Schedule unreferenced deadlines; tests can drive the same lifetime without wall-clock sleeps. */
const schedule: NativeInjectionScheduler = (callback, ms) => {
  const timer = setTimeout(callback, ms); timer.unref?.();
  return () => clearTimeout(timer);
};
/** Recognize JSON records without permitting array-shaped envelopes. */
function record(value: unknown): value is Frame { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** Keep response and call identities bounded and free from control characters. */
function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= CODEX_WS_ID_MAX_BYTES && !/[\u0000-\u001f\u007f]/.test(value);
}
/** Produce content-free local refusals, distinct from real upstream injection acknowledgements. */
function reject(code: string, message: string): never { throw new NativeSteeringError(code, message); }

/**
 * One opt-in multi-agent response owns one socket. The public success ACK has no
 * injection ID, so dispatch one packet at a time and bound the unsent FIFO. An
 * injection is not a new turn, retry, tool execution, or steering submission.
 */
export class NativeInjectionChannel implements NativeResponseControl {
  readonly kind = "injection" as const;
  relayActive = false;
  replayFactory?: () => NativeSteeringReplayObserver;
  private replay?: NativeSteeringReplayObserver;
  private sender?: (frame: Frame) => void;
  private fail?: (error: Error) => void;
  private responseId?: string;
  private terminal = false;
  private finished = false;
  private everAttached = false;
  private queue: Packet[] = [];
  private inFlight = false;
  private bytes = 0;
  private callBytes = 0;
  private lastAck = -1;
  private calls = new Map<string, string>();
  private attempted = new Set<string>();
  private tools = new Set<string>();
  private correlation = new CodexWsCorrelation(true, () => false);
  private cancelAck?: () => void;
  private cancelIdle?: () => void;

  /** A caller must select multi-agent mode and its beta explicitly; never manufacture capability. */
  constructor(initial: Frame, private readonly idleMs = 300_000, private readonly ackMs = NATIVE_INJECTION_ACK_MS, private readonly deadline: NativeInjectionScheduler = schedule) {
    if (!record(initial.multi_agent) || initial.multi_agent.enabled !== true || initial.stream_id !== undefined) {
      reject("injection_not_supported", "Native injection requires multi_agent.enabled and a single, untagged WebSocket lane.");
    }
    if (Array.isArray(initial.tools)) for (const tool of initial.tools) {
      if (record(tool) && tool.type === "function" && validId(tool.name)) this.tools.add(tool.name);
    }
  }
  /** Whether an authenticated physical transport has ever attached. */
  get attached(): boolean { return this.everAttached; }
  /** True only after the complete response/control lifetime has settled. */
  get ended(): boolean { return this.finished; }
  /** Bind after dispatch admission; the detach closure invalidates queued microtasks and timers. */
  attach(send: (frame: Frame) => void, onFailure: (error: Error) => void): () => void {
    if (this.everAttached) throw new Error("Native injection transport already owned");
    this.replay = this.replayFactory?.();
    this.everAttached = true; this.sender = send; this.fail = onFailure;
    this.armIdle(this.idleMs);
    return () => {
      if (this.sender !== send) return;
      this.sender = undefined; this.fail = undefined; this.finished = true;
      this.cancelAck?.(); this.cancelIdle?.();
      this.queue = []; this.bytes = 0; this.calls.clear(); this.attempted.clear(); this.tools.clear();
      this.correlation.finish(); this.replay?.dispose(); this.replay = undefined;
    };
  }
  /** Fail unknown delivery on timeout rather than replaying input or extending ACK deadlines on deltas. */
  private armIdle(ms: number): void {
    this.cancelIdle?.();
    this.cancelIdle = this.deadline(() => this.abort("Native injection response timed out; do not automatically replay tool results."), ms);
  }
  /** Steering and multi-agent injection use different server contracts. */
  steer(_frame: Frame): never { return reject("steering_not_supported", "Steering is not supported by this multi-agent injection session."); }
  /** An ordinary new turn may replace a settled parent, never an unresolved injection. */
  continue(_frame: Frame): boolean {
    if (!this.sender || this.finished) return false;
    if (this.queue.length) reject("injection_pending", "Wait for every injection confirmation before starting another response; do not replay results.");
    if (this.terminal) this.replay?.finish?.();
    return false;
  }
  /** Validate/snapshot results and reserve all IDs and bytes atomically before any physical send. */
  inject(frame: Frame): void {
    if (!this.sender || this.finished || !this.responseId) reject("injection_not_supported", "No active native injection transport; this route may be disabled or using HTTP fallback.");
    if (frame.type !== "response.inject" || frame.response_id !== this.responseId || !validId(frame.response_id)) {
      reject("response_not_active", "The injection target does not belong to this connection.");
    }
    if (Object.keys(frame).some(key => !["type", "response_id", "input"].includes(key)) || !Array.isArray(frame.input)
      || !frame.input.length || frame.input.length > MAX_CALLS) reject("invalid_input", "Supply only a nonempty list of saved function outputs.");
    const ids = new Set<string>();
    for (const item of frame.input as unknown[]) {
      if (!record(item) || item.type !== "function_call_output" || !validId(item.call_id) || typeof item.output !== "string"
        || Object.keys(item).some(key => !["type", "call_id", "output"].includes(key))) reject("invalid_input", "Only string-valued function_call_output items are supported for injection.");
      if (!this.calls.has(item.call_id as string)) reject("unknown_tool_call", "Injection results must belong to a completed client-owned function call on this response.");
      if (ids.has(item.call_id as string) || this.attempted.has(item.call_id as string)) reject("duplicate_injection", "A result for this function call has already been submitted; do not replay it.");
      ids.add(item.call_id as string);
    }
    const text = JSON.stringify(frame), bytes = Buffer.byteLength(text);
    if (codexWsCreateFrameExceedsLimit(text) || this.bytes + bytes > MAX_NATIVE_INJECTION_BYTES || this.queue.length >= MAX_NATIVE_INJECTIONS) {
      reject("injection_queue_full", "Native injection queue or byte limit exceeded; this input was not sent.");
    }
    const snapshot = JSON.parse(text) as Frame;
    try { this.replay?.submitted(snapshot); }
    catch { reject("injection_replay_full", "Native injection replay budget exceeded; this input was not sent."); }
    for (const id of ids) this.attempted.add(id);
    this.queue.push({ frame: snapshot, bytes }); this.bytes += bytes;
    this.pump();
  }
  /** Make transport failure terminal even when a test or embedder delays its detach callback. */
  private abort(message: string): void {
    if (this.finished) return;
    this.finished = true;
    this.cancelAck?.(); this.cancelIdle?.();
    this.fail?.(new Error(message));
  }
  /** Send each queued packet once. Subsequent sends re-enter the transport's credential guard. */
  private pump(): void {
    if (this.inFlight || !this.sender || this.finished || !this.queue.length) return;
    this.inFlight = true;
    this.cancelAck = this.deadline(() => this.abort("Native injection acknowledgement timed out; delivery is unknown. Do not automatically replay results."), this.ackMs);
    try { this.sender(this.queue[0].frame); }
    catch { this.abort("Native injection send failed; delivery is unknown. Do not automatically replay results."); }
  }
  /** Admit only declared client functions, not server-owned multi_agent_call operations. */
  private advertise(item: unknown): void {
    if (!record(item) || item.type !== "function_call") return;
    if (!validId(item.call_id) || !validId(item.id) || !validId(item.name) || !this.tools.has(item.name)) throw new Error("Native injection received an undeclared or invalid function call");
    if (this.calls.has(item.call_id)) {
      if (this.calls.get(item.call_id) !== item.id) throw new Error("Native injection function identity changed");
      return;
    }
    const size = Buffer.byteLength(item.call_id);
    if (this.calls.size >= MAX_CALLS || this.callBytes + size > 256 * 1024) throw new Error("Native injection call identity budget exceeded");
    this.calls.set(item.call_id, String(item.id)); this.callBytes += size;
  }
  /** Validate ordered root events and drain confirmations even after the root has completed. */
  observe(event: Frame): boolean {
    if (this.finished) throw new Error("Native injection event after settlement");
    if (event.stream_id !== undefined) throw new Error("Native injection does not support multiplexed lanes");
    this.correlation.accept(event);
    const type = event.type;
    if (typeof type === "string" && type.startsWith("response.inject.")) {
      const packet = this.queue[0];
      if (!this.inFlight || !packet || event.response_id !== this.responseId || !Number.isSafeInteger(event.sequence_number)
        || (event.sequence_number as number) <= this.lastAck) throw new Error("Native injection confirmation identity/order mismatch");
      if (type === "response.inject.failed") {
        if (!record(event.error) || !["response_already_completed", "response_not_found"].includes(String(event.error.code))
          || !Array.isArray(event.input) || event.input.length !== (packet.frame.input as unknown[]).length
          || event.input.some((item, i) => !record(item) || item.type !== "function_call_output"
            || item.call_id !== (packet.frame.input as Frame[])[i].call_id || item.output !== (packet.frame.input as Frame[])[i].output)) {
          throw new Error("Native injection rejection does not match the pending packet");
        }
      } else if (type !== "response.inject.created") throw new Error("Unsupported native injection acknowledgement");
      this.lastAck = event.sequence_number as number;
      this.replay?.observe(event);
      this.cancelAck?.(); this.cancelAck = undefined;
      this.queue.shift(); this.bytes -= packet.bytes; this.inFlight = false;
      // Never emit a nested synchronous ACK before the current event reaches the relay.
      queueMicrotask(() => this.pump());
    } else {
      if (typeof type === "string" && type.startsWith("response.steer.")) throw new Error("Unexpected steering event on an injection response");
      if (this.terminal && type !== "error") throw new Error("Unexpected response event after injection parent completion");
      if (type === "response.created" && record(event.response)) this.responseId = String(event.response.id);
      if (type === "response.output_item.done") this.advertise(event.item);
      if (["response.completed", "response.failed", "response.incomplete"].includes(String(type))) {
        if (!record(event.response) || event.response.id !== this.responseId) throw new Error("Native injection terminal identity mismatch");
        this.terminal = true;
        if (Array.isArray(event.response.output)) for (const item of event.response.output) this.advertise(item);
        this.armIdle(this.ackMs);
      }
      this.replay?.observe(event);
    }
    if (["error", "response.failed", "response.incomplete"].includes(String(type))) this.finished = true;
    else this.finished = this.terminal && !this.queue.length && this.attempted.size === this.calls.size;
    if (this.finished) { this.replay?.finish?.(); this.cancelIdle?.(); this.cancelAck?.(); }
    else if (!this.terminal) this.armIdle(this.idleMs);
    return this.finished;
  }
}
