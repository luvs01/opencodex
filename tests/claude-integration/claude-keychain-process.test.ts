import { expect, test } from "bun:test";
import { runKeychainRequest, type KeychainProcessDeps, type KeychainSpawnOptions } from "../../src/claude/keychain-process";
import {
  KEYCHAIN_HEADER_BYTES, KEYCHAIN_MAX_BYTES, KEYCHAIN_NOT_FOUND, KEYCHAIN_PENDING,
  KEYCHAIN_SUCCESS, KEYCHAIN_UNAVAILABLE, keychainControl, keychainOutput, type KeychainOperation,
} from "../../src/claude/keychain-protocol";

function fixture(operation: KeychainOperation = "read") {
  const request = { operation, buffer: new SharedArrayBuffer(KEYCHAIN_HEADER_BYTES + (operation === "read" ? KEYCHAIN_MAX_BYTES : 0)) };
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let exit!: (code: number) => void, rejectExit!: (error: Error) => void;
  let cancellations = 0, kills = 0, unrefs = 0;
  const calls: Array<{ argv: string[]; options: KeychainSpawnOptions }> = [];
  const child = {
    stdout: new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancellations++; } }),
    exited: new Promise<number>((resolve, reject) => { exit = resolve; rejectExit = reject; }),
    signalCode: null as NodeJS.Signals | number | null,
    unref() { unrefs++; },
    kill() { kills++; },
  };
  const deps: KeychainProcessDeps = { spawn(argv, options) { calls.push({ argv, options }); return child; } };
  return { request, child, calls, deps, exit, rejectExit,
    write: (raw: string | Uint8Array) => controller.enqueue(typeof raw === "string" ? new TextEncoder().encode(raw) : raw),
    close: () => controller.close(), failOutput: () => controller.error(new Error("synthetic-private-error")),
    state: () => Atomics.load(keychainControl(request.buffer), 0),
    raw: () => new TextDecoder().decode(keychainOutput(request.buffer).subarray(0, Atomics.load(keychainControl(request.buffer), 1))),
    counts: () => ({ cancellations, kills, unrefs }),
  };
}

test("password reads use the absolute executable, fixed service and no process deadline", async () => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  expect(f.calls).toEqual([{ argv: ["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
    options: { stdin: "ignore", stdout: "pipe", stderr: "ignore" } }]);
  expect(f.state()).toBe(KEYCHAIN_PENDING);
  f.write("synthetic-credential"); f.close(); f.exit(0);
  expect(await pending).toBe(true);
  expect(f.raw()).toBe("synthetic-credential");
  expect(f.counts()).toEqual({ cancellations: 0, kills: 0, unrefs: 1 });
});

test("metadata probes never request passwords and capture no stdio", async () => {
  const f = fixture("probe"), pending = runKeychainRequest(f.request, f.deps);
  expect(f.calls).toEqual([{ argv: ["/usr/bin/security", "find-generic-password", "-s", "Claude Code-credentials"],
    options: { stdin: "ignore", stdout: "ignore", stderr: "ignore" } }]);
  expect(keychainOutput(f.request.buffer)).toHaveLength(0);
  f.exit(0); f.close();
  expect(await pending).toBe(true);
  expect(f.state()).toBe(KEYCHAIN_SUCCESS);
});

test("stdout EOF alone does not release a still-live child", async () => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  f.write("synthetic-credential"); f.close();
  await Bun.sleep(5);
  expect(f.state()).toBe(KEYCHAIN_PENDING);
  expect(f.counts().kills).toBe(0);
  f.exit(0); await pending;
  expect(f.state()).toBe(KEYCHAIN_SUCCESS);
});

test("process exit alone does not publish incomplete stdout", async () => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  f.exit(0);
  await Bun.sleep(5);
  expect(f.state()).toBe(KEYCHAIN_PENDING);
  f.write("synthetic-after-exit"); f.close(); await pending;
  expect(f.state()).toBe(KEYCHAIN_SUCCESS);
  expect(f.raw()).toBe("synthetic-after-exit");
});

for (const operation of ["read", "probe"] as const) {
  test.each([[0, KEYCHAIN_SUCCESS], [44, KEYCHAIN_NOT_FOUND], [1, KEYCHAIN_UNAVAILABLE], [36, KEYCHAIN_UNAVAILABLE]] as const)(
    `${operation} exit %i preserves status %i`, async (code, status) => {
      const f = fixture(operation), pending = runKeychainRequest(f.request, f.deps);
      if (operation === "read") f.write("synthetic-output");
      f.close(); f.exit(code); await pending;
      expect(f.state()).toBe(status);
      if (status !== KEYCHAIN_SUCCESS) expect(keychainOutput(f.request.buffer).every(byte => byte === 0)).toBe(true);
    });
}

test.each(["SIGTERM", 9] as const)("signal %s is unavailable even with a misleading zero exit code", async signal => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  f.child.signalCode = signal;
  f.write("synthetic-output"); f.close(); f.exit(0); await pending;
  expect(f.state()).toBe(KEYCHAIN_UNAVAILABLE);
  expect(keychainOutput(f.request.buffer).every(byte => byte === 0)).toBe(true);
});

test("an output read error waits for actual child exit and returns no partial credential", async () => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  f.write("synthetic-output"); f.failOutput();
  await Bun.sleep(5);
  expect(f.state()).toBe(KEYCHAIN_PENDING);
  expect(f.counts().kills).toBe(0);
  f.exit(0); await pending;
  expect(f.state()).toBe(KEYCHAIN_UNAVAILABLE);
  expect(f.raw()).toBe("");
});

test("overflow discards all output, continues draining and never cancels or kills", async () => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  f.write(new Uint8Array(KEYCHAIN_MAX_BYTES).fill(65));
  f.write("overflow"); f.write("still-drained");
  await Bun.sleep(5);
  expect(f.state()).toBe(KEYCHAIN_PENDING);
  expect(f.counts()).toEqual({ cancellations: 0, kills: 0, unrefs: 1 });
  f.close(); f.exit(0); await pending;
  expect(f.state()).toBe(KEYCHAIN_UNAVAILABLE);
  expect(keychainOutput(f.request.buffer).every(byte => byte === 0)).toBe(true);
  expect(f.raw()).toBe("");
});

test("capture accepts exactly the byte bound and preserves split UTF-8 sequences", async () => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  const bytes = new TextEncoder().encode("synthetic-한글");
  f.write(bytes.subarray(0, bytes.length - 1));
  f.write(bytes.subarray(bytes.length - 1));
  f.write(new Uint8Array(KEYCHAIN_MAX_BYTES - bytes.length).fill(32));
  f.close(); f.exit(0); await pending;
  expect(f.state()).toBe(KEYCHAIN_SUCCESS);
  expect(Atomics.load(keychainControl(f.request.buffer), 1)).toBe(KEYCHAIN_MAX_BYTES);
  expect(f.raw().trim()).toBe("synthetic-한글");
});

test("spawn failure publishes unavailable without exposing the exception", async () => {
  const f = fixture();
  expect(await runKeychainRequest(f.request, { spawn() { throw new Error("synthetic-private-error"); } })).toBe(true);
  expect(f.state()).toBe(KEYCHAIN_UNAVAILABLE);
  expect(f.raw()).toBe("");
  f.close(); f.exit(0);
});

test("an unconfirmed exit quarantines the request and erases unusable late output", async () => {
  const f = fixture(), pending = runKeychainRequest(f.request, f.deps);
  f.rejectExit(new Error("synthetic-private-error"));
  expect(await pending).toBe(false);
  expect(f.state()).toBe(KEYCHAIN_PENDING);
  f.write("synthetic-late-output"); f.close();
  await Bun.sleep(5);
  expect(f.state()).toBe(KEYCHAIN_PENDING);
  expect(keychainOutput(f.request.buffer).every(byte => byte === 0)).toBe(true);
  expect(f.counts()).toEqual({ cancellations: 0, kills: 0, unrefs: 1 });
});
