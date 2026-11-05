import { spawnWorker } from "../lib/worker-embed";
import { isTestHomeGuardArmed } from "../lib/test-home-guard";
import {
  KEYCHAIN_HEADER_BYTES, KEYCHAIN_MAX_BYTES, KEYCHAIN_NOT_FOUND, KEYCHAIN_PENDING,
  KEYCHAIN_SUCCESS, keychainControl, keychainOutput,
  type KeychainOperation, type KeychainRequest,
} from "./keychain-protocol";

export type KeychainPresence = "present" | "absent" | "unknown";
type KeychainWorker = Pick<Worker, "postMessage" | "addEventListener"> & { unref(): void };
interface KeychainJob extends KeychainRequest { deadline: number }

/** IO seams keep regression tests away from the user's real Keychain. */
export interface ClaudeKeychainDeps {
  platform?: NodeJS.Platform;
  createWorker?: () => KeychainWorker;
  waitMs?: Partial<Record<KeychainOperation, number>>;
}

/**
 * One in-flight operation for BOTH credential reads and metadata-only probes.
 *
 * A deadline only ends the caller's wait. The worker keeps draining `security`
 * until its actual close, including while macOS is waiting for user approval.
 * A timed-out operation continues to own the slot, so subsequent requests cannot
 * create a prompt/process storm. Completed results are never a credential cache:
 * independent calls must observe rotations for the OAuth generation fence.
 * Synchronous ownership rechecks also refuse older in-flight reads, whose
 * credential snapshot may predate the recheck even though the child is still alive.
 */
export function createClaudeKeychainAccess(deps: ClaudeKeychainDeps = {}) {
  let worker: KeychainWorker | undefined;
  let active: KeychainJob | undefined;
  let failed = false;
  const platform = () => deps.platform ?? process.platform;

  function forgetCompleted(): void {
    if (active && Atomics.load(keychainControl(active.buffer), 0) !== KEYCHAIN_PENDING) active = undefined;
  }

  function failWorker(event: Event): void {
    // Worker loss is NOT evidence its child exited. Quarantine this accessor for
    // the process lifetime instead of replacing a possibly still-blocked child.
    event.preventDefault();
    failed = true;
    if (active) Atomics.notify(keychainControl(active.buffer), 0);
  }

  function begin(operation: KeychainOperation, joinPending: boolean): KeychainJob | undefined {
    if (platform() !== "darwin" || failed) return undefined;
    // Changing HOME cannot sandbox the OS credential store. Tests use an injected
    // worker; the real reader must never open the operator's Keychain or its UI.
    if (!deps.createWorker && isTestHomeGuardArmed()) return undefined;
    forgetCompleted();
    if (active) return joinPending && active.operation === operation ? active : undefined;
    const waitMs = deps.waitMs?.[operation] ?? (operation === "read" ? 5_000 : 1_500);
    const job: KeychainJob = {
      operation,
      buffer: new SharedArrayBuffer(KEYCHAIN_HEADER_BYTES + (operation === "read" ? KEYCHAIN_MAX_BYTES : 0)),
      deadline: performance.now() + waitMs,
    };
    active = job;
    try {
      if (!worker) {
        worker = deps.createWorker?.()
          ?? spawnWorker(new URL("./keychain-worker.ts", import.meta.url).href, "claude-keychain-worker") as Worker & { unref(): void };
        worker.addEventListener("error", failWorker);
        worker.addEventListener("messageerror", failWorker);
        worker.addEventListener("close", failWorker);
        worker.addEventListener("message", forgetCompleted);
        // A pending Keychain prompt must not keep a short-lived CLI alive.
        // unref changes event-loop ownership; it does not terminate the worker.
        worker.unref();
      }
      worker.postMessage({ operation, buffer: job.buffer } satisfies KeychainRequest);
      return job;
    } catch {
      failed = true;
      return undefined;
    }
  }

  function waitSync(job: KeychainJob | undefined): KeychainJob | undefined {
    if (!job) return undefined;
    const control = keychainControl(job.buffer);
    const remaining = job.deadline - performance.now();
    if (remaining <= 0) return undefined;
    if (Atomics.wait(control, 0, KEYCHAIN_PENDING, remaining) === "timed-out" || failed) return undefined;
    return job;
  }

  async function waitAsync(job: KeychainJob | undefined): Promise<KeychainJob | undefined> {
    if (!job) return undefined;
    const remaining = job.deadline - performance.now();
    if (remaining <= 0) return undefined;
    const wait = Atomics.waitAsync(keychainControl(job.buffer), 0, KEYCHAIN_PENDING, remaining);
    if (await wait.value === "timed-out" || failed) return undefined;
    return job;
  }

  function readResult(job: KeychainJob | undefined): string | null {
    if (!job) return null;
    const control = keychainControl(job.buffer);
    if (Atomics.load(control, 0) !== KEYCHAIN_SUCCESS) return null;
    const length = Atomics.load(control, 1);
    if (length < 0 || length > KEYCHAIN_MAX_BYTES) return null;
    return new TextDecoder().decode(keychainOutput(job.buffer).subarray(0, length)).trim();
  }

  return {
    readSync(): string | null {
      return readResult(waitSync(begin("read", false)));
    },
    async readAsync(): Promise<string | null> {
      return readResult(await waitAsync(begin("read", true))) || null;
    },
    probeSync(): KeychainPresence {
      if (platform() !== "darwin") return "absent";
      const job = waitSync(begin("probe", true));
      if (!job) return "unknown";
      switch (Atomics.load(keychainControl(job.buffer), 0)) {
        case KEYCHAIN_SUCCESS: return "present";
        case KEYCHAIN_NOT_FOUND: return "absent";
        default: return "unknown";
      }
    },
  };
}

const keychain = createClaudeKeychainAccess();
export function readClaudeKeychain(): string | null { return keychain.readSync(); }
export function readClaudeKeychainAsync(): Promise<string | null> { return keychain.readAsync(); }
export function probeClaudeKeychain(): KeychainPresence { return keychain.probeSync(); }
