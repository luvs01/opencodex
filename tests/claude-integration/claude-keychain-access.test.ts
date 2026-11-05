import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClaudeKeychainAccess, type ClaudeKeychainDeps } from "../../src/claude/keychain";
import * as workerEmbed from "../../src/lib/worker-embed";
import {
  KEYCHAIN_MAX_BYTES, KEYCHAIN_NOT_FOUND, KEYCHAIN_PENDING, KEYCHAIN_SUCCESS, KEYCHAIN_UNAVAILABLE,
  finishKeychainRequest, keychainControl, keychainOutput, type KeychainRequest,
} from "../../src/claude/keychain-protocol";
import { helperPath } from "../helpers/repo-root";
import {
  FIXTURE_READY, FIXTURE_PID, FIXTURE_SPAWNS, FIXTURE_EXITS, FIXTURE_EXIT_CODE, FIXTURE_FINISHED, FIXTURE_WORDS,
  type KeychainFixtureConfiguration,
} from "../helpers/claude-keychain-fixture-worker";

/** A worker double, not a child-process mock: a caller deadline cannot complete its request. */
class FixtureWorker extends EventTarget {
  readonly requests: KeychainRequest[] = [];
  unrefs = 0;
  terminations = 0;
  onSend?: (request: KeychainRequest) => void;
  postMessage(request: KeychainRequest): void {
    this.requests.push(request);
    this.onSend?.(request);
  }
  unref(): void { this.unrefs++; }
  terminate(): void { this.terminations++; }
  finish(index: number, status: number, raw = "", notify = true): void {
    complete(this.requests[index]!, status, raw);
    if (notify) this.dispatchEvent(new MessageEvent("message"));
  }
}

function complete(request: KeychainRequest, status: number, raw = ""): void {
  const bytes = new TextEncoder().encode(raw);
  if (request.operation === "read") keychainOutput(request.buffer).set(bytes);
  finishKeychainRequest(request, status, request.operation === "read" ? bytes.length : 0);
}

function fixture(overrides: ClaudeKeychainDeps = {}) {
  const worker = new FixtureWorker();
  let creations = 0;
  const access = createClaudeKeychainAccess({
    platform: "darwin", waitMs: { read: 15, probe: 10 },
    createWorker: () => {
      creations++;
      return worker as unknown as ReturnType<NonNullable<ClaudeKeychainDeps["createWorker"]>>;
    },
    ...overrides,
  });
  return { worker, access, creations: () => creations };
}

test("first synchronous Keychain read returns the credential and each completed call observes rotation", () => {
  const { worker, access } = fixture();
  worker.onSend = request => complete(request, KEYCHAIN_SUCCESS, `  synthetic-generation-${worker.requests.length}\n`);
  expect(access.readSync()).toBe("synthetic-generation-1");
  expect(access.readSync()).toBe("synthetic-generation-2");
  expect(worker.requests).toHaveLength(2);
  expect(worker.unrefs).toBe(1);
  expect(worker.terminations).toBe(0);
});

test.each(["linux", "win32"] as const)("%s never creates a Keychain worker", async platform => {
  const { worker, access, creations } = fixture({ platform });
  expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
  expect(access.probeSync()).toBe("absent");
  expect(creations()).toBe(0);
  expect(worker.requests).toHaveLength(0);
});

test("the test-home guard refuses the real OS Keychain even with a sandboxed HOME", async () => {
  const spawn = spyOn(workerEmbed, "spawnWorker").mockImplementation(() => {
    throw new Error("A test must never start the production Keychain worker");
  });
  try {
    const access = createClaudeKeychainAccess({ platform: "darwin" });
    expect(access.readSync()).toBeNull();
    expect(await access.readAsync()).toBeNull();
    expect(access.probeSync()).toBe("unknown");
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    spawn.mockRestore();
  }
});

test("synchronous deadline leaves the operation pending and repeated callers do not send or terminate", async () => {
  const { worker, access } = fixture();
  const started = performance.now();
  expect(access.readSync()).toBeNull();
  expect(performance.now() - started).toBeLessThan(500);
  for (let i = 0; i < 10; i++) expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
  expect(keychainControl(worker.requests[0]!.buffer)[0]).toBe(KEYCHAIN_PENDING);
  expect(worker.requests).toHaveLength(1);
  expect(worker.terminations).toBe(0);
});

test("concurrent asynchronous callers share one live read and receive the same result", async () => {
  const { worker, access } = fixture({ waitMs: { read: 500 } });
  const pending = Array.from({ length: 20 }, () => access.readAsync());
  expect(worker.requests).toHaveLength(1);
  worker.finish(0, KEYCHAIN_SUCCESS, "synthetic-shared-result");
  expect(await Promise.all(pending)).toEqual(Array(20).fill("synthetic-shared-result"));
  expect(worker.terminations).toBe(0);
});

test("a synchronous ownership recheck refuses an older in-flight snapshot while async callers share it", async () => {
  const { worker, access } = fixture({ waitMs: { read: 500 } });
  const original = access.readAsync(), joined = access.readAsync();
  expect(worker.requests).toHaveLength(1);
  expect(keychainControl(worker.requests[0]!.buffer)[0]).toBe(KEYCHAIN_PENDING);
  // The child has copied the old credential but has not closed. If the sync
  // recheck joins it, complete that old snapshot exactly when it starts waiting:
  // the former implementation deterministically returns the stale generation.
  const wait = spyOn(Atomics, "wait").mockImplementation(() => {
    worker.finish(0, KEYCHAIN_SUCCESS, "synthetic-before-rotation");
    return "ok";
  });
  try {
    expect(access.readSync()).toBeNull();
    expect(wait).not.toHaveBeenCalled();
    expect(worker.requests).toHaveLength(1);
  } finally {
    wait.mockRestore();
    worker.finish(0, KEYCHAIN_SUCCESS, "synthetic-before-rotation");
  }
  expect(await Promise.all([original, joined])).toEqual([
    "synthetic-before-rotation", "synthetic-before-rotation",
  ]);
  worker.onSend = request => complete(request, KEYCHAIN_SUCCESS, "synthetic-after-rotation");
  expect(access.readSync()).toBe("synthetic-after-rotation");
  expect(worker.requests).toHaveLength(2);
  expect(worker.terminations).toBe(0);
});

test("a blocked password read also owns the metadata-probe slot", async () => {
  const { worker, access } = fixture({ waitMs: { read: 500 } });
  const pending = access.readAsync();
  expect(access.probeSync()).toBe("unknown");
  expect(worker.requests.map(request => request.operation)).toEqual(["read"]);
  worker.finish(0, KEYCHAIN_SUCCESS, "synthetic-read-result");
  expect(await pending).toBe("synthetic-read-result");
  worker.onSend = request => complete(request, KEYCHAIN_NOT_FOUND);
  expect(access.probeSync()).toBe("absent");
  expect(worker.requests.map(request => request.operation)).toEqual(["read", "probe"]);
});

test("a blocked metadata probe prevents both read variants from starting password access", async () => {
  const { worker, access } = fixture();
  expect(access.probeSync()).toBe("unknown");
  expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
  expect(access.probeSync()).toBe("unknown");
  expect(worker.requests.map(request => request.operation)).toEqual(["probe"]);
  expect(keychainOutput(worker.requests[0]!.buffer)).toHaveLength(0);
  worker.finish(0, KEYCHAIN_NOT_FOUND);
  worker.onSend = request => complete(request, KEYCHAIN_SUCCESS, "synthetic-after-probe");
  expect(access.readSync()).toBe("synthetic-after-probe");
});

test("late completion releases the slot but its credential is not cached for a later call", async () => {
  const { worker, access } = fixture();
  expect(await access.readAsync()).toBeNull();
  worker.finish(0, KEYCHAIN_SUCCESS, "synthetic-old-generation", false);
  worker.onSend = request => complete(request, KEYCHAIN_SUCCESS, "synthetic-current-generation");
  expect(access.readSync()).toBe("synthetic-current-generation");
  expect(worker.requests).toHaveLength(2);
});

test("a delayed completion message cannot release a newer pending operation", async () => {
  const { worker, access } = fixture({ waitMs: { read: 500 } });
  const old = access.readAsync();
  worker.finish(0, KEYCHAIN_SUCCESS, "synthetic-old", false);
  expect(await old).toBe("synthetic-old");
  const current = access.readAsync();
  worker.dispatchEvent(new MessageEvent("message"));
  const joined = access.readAsync();
  expect(worker.requests).toHaveLength(2);
  worker.finish(1, KEYCHAIN_SUCCESS, "synthetic-current");
  expect(await Promise.all([current, joined])).toEqual(["synthetic-current", "synthetic-current"]);
});

test.each([
  [KEYCHAIN_NOT_FOUND, "absent"], [KEYCHAIN_UNAVAILABLE, "unknown"], [99, "unknown"],
] as const)("result %i preserves read failure and metadata %s", async (status, presence) => {
  const { worker, access } = fixture();
  worker.onSend = request => complete(request, status);
  expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
  expect(access.probeSync()).toBe(presence);
});

test("empty output preserves the existing sync/async distinction and metadata success", async () => {
  const { worker, access } = fixture();
  worker.onSend = request => complete(request, KEYCHAIN_SUCCESS, "  \n");
  expect(access.readSync()).toBe("");
  expect(await access.readAsync()).toBeNull();
  expect(access.probeSync()).toBe("present");
});

test.each([-1, KEYCHAIN_MAX_BYTES + 1])("an invalid published output length %i is not decoded", async length => {
  const { worker, access } = fixture();
  worker.onSend = request => finishKeychainRequest(request, KEYCHAIN_SUCCESS, length);
  expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
});

test.each(["error", "messageerror", "close"])("worker %s quarantines its potentially live child", async eventType => {
  const { worker, access, creations } = fixture({ waitMs: { read: 1_000 } });
  const pending = access.readAsync();
  const event = new Event(eventType, { cancelable: true });
  const started = performance.now();
  worker.dispatchEvent(event);
  expect(await pending).toBeNull();
  expect(performance.now() - started).toBeLessThan(500);
  expect(event.defaultPrevented).toBe(true);
  expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
  expect(access.probeSync()).toBe("unknown");
  expect(creations()).toBe(1);
  expect(worker.requests).toHaveLength(1);
  expect(worker.terminations).toBe(0);
});

test("worker creation failure degrades without an initialization retry storm", async () => {
  let attempts = 0;
  const access = createClaudeKeychainAccess({ platform: "darwin", createWorker: () => {
    attempts++;
    throw new Error("synthetic worker unavailable");
  } });
  expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
  expect(access.probeSync()).toBe("unknown");
  expect(attempts).toBe(1);
});

test("a failed dispatch is quarantined without replacing a possibly running worker", async () => {
  const { worker, access, creations } = fixture();
  worker.onSend = () => { throw new Error("synthetic dispatch failure"); };
  expect(access.readSync()).toBeNull();
  expect(await access.readAsync()).toBeNull();
  expect(access.probeSync()).toBe("unknown");
  expect(creations()).toBe(1);
  expect(worker.requests).toHaveLength(1);
});

test("default caller budgets remain five seconds for reads and 1.5 seconds for probes", async () => {
  const syncBudgets: number[] = [], asyncBudgets: number[] = [];
  const sync = spyOn(Atomics, "wait").mockImplementation((_view, _index, _value, timeout) => {
    syncBudgets.push(timeout!);
    return "timed-out";
  });
  const async = spyOn(Atomics, "waitAsync").mockImplementation((_view, _index, _value, timeout) => {
    asyncBudgets.push(timeout!);
    return { async: false, value: "timed-out" };
  });
  try {
    expect(fixture({ waitMs: undefined }).access.readSync()).toBeNull();
    expect(fixture({ waitMs: undefined }).access.probeSync()).toBe("unknown");
    expect(await fixture({ waitMs: undefined }).access.readAsync()).toBeNull();
    expect(syncBudgets[0]).toBeGreaterThan(4_000);
    expect(syncBudgets[0]).toBeLessThanOrEqual(5_000);
    expect(syncBudgets[1]).toBeGreaterThan(1_000);
    expect(syncBudgets[1]).toBeLessThanOrEqual(1_500);
    expect(asyncBudgets[0]).toBeGreaterThan(4_000);
    expect(asyncBudgets[0]).toBeLessThanOrEqual(5_000);
  } finally {
    async.mockRestore();
    sync.mockRestore();
  }
});

async function waitForFixture(control: Int32Array, index: number, minimum = 1): Promise<void> {
  const deadline = performance.now() + 2_500;
  while (Atomics.load(control, index) < minimum && performance.now() < deadline) await Bun.sleep(5);
  expect(Atomics.load(control, index)).toBeGreaterThanOrEqual(minimum);
}

async function realFixture(bundled = false, released = false) {
  const root = mkdtempSync(join(tmpdir(), "ocx-keychain-child-"));
  const releasePath = join(root, "release");
  const control = new Int32Array(new SharedArrayBuffer(FIXTURE_WORDS * Int32Array.BYTES_PER_ELEMENT));
  const path = helperPath("claude-keychain-fixture-worker.ts");
  let blobUrl: string | undefined;
  let worker: Worker | undefined;
  try {
    if (bundled) {
      const build = await Bun.build({ entrypoints: [path], target: "bun", write: false });
      expect(build.success).toBe(true);
      blobUrl = URL.createObjectURL(new Blob([await build.outputs[0]!.text()], { type: "text/javascript" }));
    }
    worker = new Worker(blobUrl ?? pathToFileURL(path).href);
    const release = () => writeFileSync(releasePath, "release", { mode: 0o600 });
    if (released) release();
    worker.postMessage({ type: "fixture-config", control: control.buffer as SharedArrayBuffer, releasePath,
      output: "synthetic-process-result" } satisfies KeychainFixtureConfiguration);
    Atomics.wait(control, FIXTURE_READY, 0, 2_000);
    expect(Atomics.load(control, FIXTURE_READY)).toBe(1);
    const access = createClaudeKeychainAccess({ platform: "darwin", waitMs: { read: released ? 1_000 : 30, probe: released ? 1_000 : 20 },
      createWorker: () => worker as unknown as ReturnType<NonNullable<ClaudeKeychainDeps["createWorker"]>> });
    return { access, control, release, async close() {
      release();
      // Terminate only this test worker, after its synthetic child exited naturally.
      // An unproven exit retains the directory instead of deleting a live fixture's files.
      await waitForFixture(control, FIXTURE_FINISHED);
      expect(Atomics.load(control, FIXTURE_EXITS)).toBe(1);
      worker!.terminate();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      rmSync(root, { recursive: true, force: true });
    } };
  } catch (error) {
    // Initialization has not dispatched a request and therefore owns no child.
    worker?.terminate();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("a real worker supplies the first synchronous result while the parent thread is waiting", async () => {
  const fixture = await realFixture(false, true);
  try {
    expect(fixture.access.readSync()).toBe("synthetic-process-result");
    expect(Atomics.load(fixture.control, FIXTURE_SPAWNS)).toBe(1);
    await waitForFixture(fixture.control, FIXTURE_FINISHED);
    expect(Atomics.load(fixture.control, FIXTURE_EXIT_CODE)).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("a real metadata child completes with all stdio ignored", async () => {
  const fixture = await realFixture(false, true);
  try {
    expect(fixture.access.probeSync()).toBe("present");
    await waitForFixture(fixture.control, FIXTURE_FINISHED);
    expect(Atomics.load(fixture.control, FIXTURE_SPAWNS)).toBe(1);
    expect(Atomics.load(fixture.control, FIXTURE_EXIT_CODE)).toBe(0);
  } finally {
    await fixture.close();
  }
});

test.each(["sync", "async"] as const)("real %s deadline leaves one child alive until natural completion", async mode => {
  // The async case also covers a bundled Blob worker, the standalone delivery format.
  const fixture = await realFixture(mode === "async");
  let heartbeat = 0;
  const timer = setInterval(() => { heartbeat++; }, 2);
  try {
    const started = performance.now();
    const result = mode === "sync" ? fixture.access.readSync() : await fixture.access.readAsync();
    expect(result).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
    if (mode === "async") expect(heartbeat).toBeGreaterThan(0);
    await waitForFixture(fixture.control, FIXTURE_PID);
    const pid = Atomics.load(fixture.control, FIXTURE_PID);
    expect(() => process.kill(pid, 0)).not.toThrow(); // Signal zero only checks liveness.
    expect(Atomics.load(fixture.control, FIXTURE_EXITS)).toBe(0);
    expect(fixture.access.readSync()).toBeNull();
    expect(await fixture.access.readAsync()).toBeNull();
    expect(fixture.access.probeSync()).toBe("unknown");
    expect(Atomics.load(fixture.control, FIXTURE_SPAWNS)).toBe(1);
    fixture.release();
    await waitForFixture(fixture.control, FIXTURE_FINISHED);
    expect(Atomics.load(fixture.control, FIXTURE_EXIT_CODE)).toBe(0);
    expect(Atomics.load(fixture.control, FIXTURE_EXITS)).toBe(1);
  } finally {
    clearInterval(timer);
    await fixture.close();
  }
});
