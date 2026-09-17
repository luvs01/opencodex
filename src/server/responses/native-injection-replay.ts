import { MAX_NATIVE_STEERING_REPLAY_BYTES, type NativeSteeringReplayObserver } from "./native-steering-replay";

type Frame = Record<string, unknown>;
/** JSON object guard; never interpret a list as an event or output item. */
function record(value: unknown): value is Frame { return value !== null && typeof value === "object" && !Array.isArray(value); }

/**
 * Keep injection input separate from steering. Only server-confirmed results enter
 * replay, after their matching function calls. Publish only when the owner settles
 * every queued injection, including confirmations arriving after response.completed.
 */
export class NativeInjectionReplay implements NativeSteeringReplayObserver {
  private prefix: unknown[];
  private outputs = new Map<number, Frame>();
  private pending: Frame[][] = [];
  private accepted = new Map<string, Frame>();
  private terminal?: Frame;
  private bytes = 0;
  private published = false;

  /** Capture a bounded initial prefix without changing caller-owned request bodies. */
  constructor(input: unknown, private readonly remember: (input: unknown[], response: Frame) => void) {
    this.prefix = typeof input === "string" ? [{ type: "message", role: "user", content: input }] : Array.isArray(input) ? [...input] : [];
    this.reserve(this.prefix);
  }
  /** Reserve serialized history bytes before retaining any new payload. */
  private reserve(value: unknown): number {
    const size = Buffer.byteLength(JSON.stringify(value));
    if (this.bytes + size > MAX_NATIVE_STEERING_REPLAY_BYTES) throw new Error("Native injection replay history budget exceeded; input was not truncated.");
    this.bytes += size;
    return size;
  }
  /** Reserve queued results before send; rollback only removes an unacknowledged submission. */
  submitted(frame: Frame): () => void {
    const input = frame.input as Frame[];
    const size = this.reserve(input);
    this.pending.push(input);
    return () => {
      const index = this.pending.indexOf(input);
      if (index >= 0) { this.pending.splice(index, 1); this.bytes -= size; }
    };
  }
  /** Observe the already-correlated stream without recording uncommitted result payloads. */
  observe(frame: Frame): void {
    if (frame.type === "response.inject.created" || frame.type === "response.inject.failed") {
      const input = this.pending.shift();
      if (!input) throw new Error("Unexpected injection replay confirmation");
      if (frame.type === "response.inject.created") {
        for (const item of input) this.accepted.set(String(item.call_id), item);
      } else this.bytes -= Buffer.byteLength(JSON.stringify(input));
    } else if (frame.type === "response.output_item.done") {
      if (!Number.isSafeInteger(frame.output_index) || (frame.output_index as number) < 0
        || (frame.output_index as number) >= 10_000 || !record(frame.item)) throw new Error("Invalid injection replay output identity");
      if (this.outputs.has(frame.output_index as number)) throw new Error("Duplicate injection replay output index");
      this.reserve(frame.item);
      this.outputs.set(frame.output_index as number, frame.item);
    } else if (frame.type === "response.completed" && record(frame.response)) {
      if (Array.isArray(frame.response.output) && frame.response.output.length) {
        for (const item of this.outputs.values()) this.bytes -= Buffer.byteLength(JSON.stringify(item));
        this.outputs.clear();
      }
      this.reserve(frame.response);
      this.terminal = frame.response;
    }
  }
  /** Commit one lossless completed snapshot, or refuse if an accepted result lost its call. */
  finish(): void {
    if (this.published || !this.terminal || this.pending.length) return;
    const source = Array.isArray(this.terminal.output) && this.terminal.output.length
      ? this.terminal.output : [...this.outputs.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
    const output: unknown[] = [];
    const committed = new Set<string>();
    for (const item of source) {
      // Injected outputs are placed exactly once, immediately after their call.
      if (record(item) && item.type === "function_call_output" && this.accepted.has(String(item.call_id))) {
        const expected = this.accepted.get(String(item.call_id))!;
        if (item.output !== expected.output) throw new Error("Conflicting injected output in completed replay");
        continue;
      }
      output.push(item);
      if (record(item) && item.type === "function_call" && this.accepted.has(String(item.call_id))) {
        const call = String(item.call_id);
        if (committed.has(call)) throw new Error("Ambiguous injection replay call identity");
        output.push(this.accepted.get(call)!);
        committed.add(call);
      }
    }
    if (committed.size !== this.accepted.size) throw new Error("Completed injection replay omitted a committed function call");
    this.remember(this.prefix, { ...this.terminal, output });
    this.published = true;
  }
  /** Drop connection-local data; uncertain injections are never persisted by teardown. */
  dispose(): void {
    this.prefix = []; this.outputs.clear(); this.pending = []; this.accepted.clear(); this.terminal = undefined; this.bytes = 0;
  }
}
