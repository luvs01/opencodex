import {
  CLAUDE_KEYCHAIN_SERVICE, KEYCHAIN_NOT_FOUND, KEYCHAIN_SUCCESS, KEYCHAIN_UNAVAILABLE,
  finishKeychainRequest, keychainOutput, type KeychainRequest,
} from "./keychain-protocol";

export interface KeychainProcess {
  stdout?: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  readonly signalCode?: NodeJS.Signals | number | null;
  unref?(): void;
}
export interface KeychainSpawnOptions {
  stdin: "ignore";
  stdout: "pipe" | "ignore";
  stderr: "ignore";
}
export interface KeychainProcessDeps {
  spawn?(argv: string[], options: KeychainSpawnOptions): KeychainProcess;
}

async function drainOutput(request: KeychainRequest, stream: KeychainProcess["stdout"]): Promise<number | null> {
  if (request.operation === "probe") return 0;
  if (!stream) return null;
  const output = keychainOutput(request.buffer);
  let length = 0, invalid = false;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (invalid) continue;
      if (value.byteLength > output.byteLength - length) {
        // A bounded capture must NOT cancel the stream or kill the child like
        // execFile's maxBuffer does. Discard excess output and keep draining.
        invalid = true;
        output.fill(0);
        continue;
      }
      output.set(value, length);
      length += value.byteLength;
    }
  } catch {
    invalid = true;
  } finally {
    reader.releaseLock();
  }
  if (invalid) { output.fill(0); return null; }
  return length;
}

/**
 * Own the child through its natural exit AND stdout completion, without a deadline.
 * Only the parent caller's wait is bounded. Return false if exit could not be
 * confirmed; its slot must remain quarantined because a child may still be alive.
 */
export async function runKeychainRequest(request: KeychainRequest, deps: KeychainProcessDeps = {}): Promise<boolean> {
  let child: KeychainProcess;
  try {
    child = (deps.spawn ?? ((argv, options) => Bun.spawn(argv, options)))([
      "/usr/bin/security", "find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE,
      ...(request.operation === "read" ? ["-w"] : []),
    ], {
      stdin: "ignore", stdout: request.operation === "read" ? "pipe" : "ignore", stderr: "ignore",
    });
  } catch {
    finishKeychainRequest(request, KEYCHAIN_UNAVAILABLE);
    return true; // No child was created.
  }
  try { child.unref?.(); } catch { /* Event-loop ownership does not decide query success. */ }
  // Start draining before waiting for exit: a full pipe must never block security.
  const drained = drainOutput(request, child.stdout).catch(() => null);
  let exitCode: number;
  try {
    exitCode = await child.exited;
  } catch {
    // Keep draining but do not publish completion or admit another subprocess.
    // A failed wait is not proof that the pending SecurityAgent query is gone.
    void drained.then(() => keychainOutput(request.buffer).fill(0));
    return false;
  }
  const length = await drained;
  const status = child.signalCode || length === null ? KEYCHAIN_UNAVAILABLE
    : exitCode === 0 ? KEYCHAIN_SUCCESS
    : exitCode === 44 ? KEYCHAIN_NOT_FOUND
    : KEYCHAIN_UNAVAILABLE;
  if (status !== KEYCHAIN_SUCCESS) keychainOutput(request.buffer).fill(0);
  finishKeychainRequest(request, status, status === KEYCHAIN_SUCCESS ? length! : 0);
  return true;
}
