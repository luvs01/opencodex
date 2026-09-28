/**
 * Serving-runtime census: which installations have served this home, newest known.
 *
 * The reported failure shape: the desktop app self-updates its bundled runtime while the
 * npm/mise install the Task Scheduler wrapper was baked against stays behind. When the
 * desktop session ends, the wrapper relaunches its pinned Bun + CLI pair and the machine
 * silently downgrades to the older package — features the operator just gained stop
 * existing, with nothing in the log saying why. The same hazard runs in reverse whenever
 * the packaged install is the stale half.
 *
 * The fix is a small census, not a resolution oracle. Every `ocx start` that reaches the
 * bind boundary records the command that would relaunch it (`argv`-shaped absolute
 * paths) plus its package version. A service child — the path where a fixed definition
 * picks the runtime, instead of the operator's shell — then asks whether a strictly newer
 * recorded install still exists on disk, re-verifies it with a bounded `--version` probe,
 * and hands the serve to it. Because only strictly newer candidates defer, the newest
 * available install converges in one hop and can never ping-pong.
 *
 * Everything here is fail-open toward the recorded install's own runtime: a missing file,
 * a malformed record, or a dead probe means "serve this install", never "stay down". The
 * registry is information a serving proxy wrote about itself; it authorizes relaunching a
 * binary the same installation already ran, nothing more.
 */
import { spawn, spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { durableBunRuntime } from "../lib/bun-runtime";
import { selfLaunchArgv } from "../lib/self-launch-argv";
import { compareStrictSemver, parseStrictSemver } from "../lib/strict-semver";
import { assertNotRealHomeUnderTest } from "../lib/test-home-guard";
import { WINDOWS_WRAPPER_PROTOCOL_ENV } from "../service/windows-wrapper-exit";
import { withOwnershipMutationLease } from "../service/ownership-mutation-lease.mjs";
import { atomicWriteFile } from "./atomic-write";
import { getConfigDir } from "./paths";

export function servingRuntimesPath(dir: string = getConfigDir()): string {
  return join(dir, "serving-runtimes.json");
}

/**
 * The argv prefix that relaunches THIS install's proxy: `[exe]` for a compiled
 * standalone binary, `[bun, cli/index.ts]` for a package install. Lives here because
 * the census is its only consumer.
 */
export function currentServingCommand(): string[] {
  return [durableBunRuntime().path, ...selfLaunchArgv([])]
    .map(part => (isAbsolute(part) ? part : join(process.cwd(), part)));
}

/** One installation's relaunch command and the version it last served. */
export interface ServedRuntimeRecord {
  /**
   * The argv prefix that relaunches this install's proxy: `[exe]` for a compiled
   * standalone binary, `[bun, cli/index.ts]` for a package install. Absolute paths only.
   */
  readonly command: readonly string[];
  readonly version: string;
  readonly servedAt: string;
  /**
   * Delegation bookkeeping, present only after this install was handed a serve and
   * exited nonzero without recording itself. Absent means "no known delegation failure";
   * `failedCount` drives the cooldown, `lastFailedAt` its expiry.
   */
  readonly delegation?: {
    readonly lastFailedAt?: string;
    readonly failedCount?: number;
  };
}

/** Bound on retained installs; the file is operator-facing state, not a log. */
const MAX_SERVING_RUNTIME_RECORDS = 16;

/**
 * Probe budget for re-verifying a recorded binary. Runs once per service-child start,
 * so a short ceiling keeps a wedged sibling binary from delaying every relaunch.
 */
const RUNTIME_VERSION_PROBE_TIMEOUT_MS = 3_000;

/**
 * Bound on candidate probes per service-child start. The census can retain up to
 * MAX_SERVING_RUNTIME_RECORDS installs and each probe carries its own timeout, so
 * without a cap a registry full of dead records would stall every relaunch by
 * RECORDS × the probe timeout.
 */
const MAX_VERSION_PROBE_ATTEMPTS = 4;

/**
 * Backoff for an install that kept exiting before it could serve. Without it the
 * service manager restarts the wrapper, the wrapper re-defers to the same broken
 * or declining runtime, and the machine loops a handoff that never logs a serve.
 * Each recorded failure buys fifteen minutes; eight failures cap the wait at two
 * hours.
 */
const DELEGATION_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const DELEGATION_FAILURE_COUNT_CAP = 8;

function canonicalPath(path: string): string {
  let resolved = path;
  try { resolved = realpathSync(path); } catch { /* keep the literal path */ }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Identity of a relaunch command. Two spellings of one binary (junction, mapped drive,
 * case fold) must collide; different installs must not.
 */
export function servingRuntimeCommandKey(command: readonly string[]): string {
  return command.map(canonicalPath).join("\u0000");
}

function isValidRecord(value: unknown): value is ServedRuntimeRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.command) || record.command.length === 0) return false;
  if (!record.command.every(part => typeof part === "string" && isAbsolute(part))) return false;
  if (typeof record.version !== "string" || parseStrictSemver(record.version) === null) return false;
  if (typeof record.servedAt !== "string") return false;
  if (record.delegation !== undefined) {
    const delegation = record.delegation as Record<string, unknown> | null;
    if (delegation === null || typeof delegation !== "object") return false;
    if (delegation.lastFailedAt !== undefined && typeof delegation.lastFailedAt !== "string") return false;
    if (delegation.failedCount !== undefined
      && (typeof delegation.failedCount !== "number" || !Number.isInteger(delegation.failedCount) || delegation.failedCount < 0)) {
      return false;
    }
  }
  return true;
}

/** Read the census. Malformed entries are dropped; a malformed file reads as empty. */
export function readServingRuntimes(dir: string = getConfigDir()): ServedRuntimeRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(servingRuntimesPath(dir), "utf-8"));
    const runtimes = (parsed as Record<string, unknown>)?.runtimes;
    if (!Array.isArray(runtimes)) return [];
    return runtimes.filter(isValidRecord);
  } catch {
    return [];
  }
}

/**
 * Record that this install served this home. Runs only after the bind boundary
 * succeeded: a start that never reached serving must not register a runtime that
 * never actually ran. Best-effort after the entry shape is validated — a census
 * write failure must never take down a healthy start.
 */
function writeServingRuntimes(records: readonly ServedRuntimeRecord[], dir: string): void {
  atomicWriteFile(servingRuntimesPath(dir), JSON.stringify({ runtimes: records.slice(0, MAX_SERVING_RUNTIME_RECORDS) }, null, 2) + "\n");
}

export function recordServingRuntime(
  record: ServedRuntimeRecord,
  dir: string = getConfigDir(),
): void {
  if (!isValidRecord(record)) return;
  try {
    assertNotRealHomeUnderTest(dir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const key = servingRuntimeCommandKey(record.command);
    // The lease makes read-merge-write atomic across installs; without it two
    // concurrent serves can each read, merge their own entry, and lose the other's.
    withOwnershipMutationLease([servingRuntimesPath(dir)], () => {
      const merged = [record, ...readServingRuntimes(dir).filter(entry => servingRuntimeCommandKey(entry.command) !== key)];
      writeServingRuntimes(merged, dir);
    });
  } catch { /* census loss must never fail a start */ }
}

/**
 * Mark that `record` was handed a serve but exited nonzero without recording
 * itself (a crash, or a stay-out — both mean this serve never happened).
 * The mark only lands when the on-disk entry still carries the `servedAt` the
 * handoff saw: a fresher `servedAt` means the child did reach the bind boundary
 * (a post-bind death is a runtime bug to fix, not a delegation failure to avoid).
 * Best-effort like every census write; a lost mark degrades to the pre-fix loop,
 * never to a worse failure.
 */
export function markServingRuntimeDelegationFailed(
  record: ServedRuntimeRecord,
  dir: string = getConfigDir(),
  now: () => number = Date.now,
): void {
  try {
    assertNotRealHomeUnderTest(dir);
    const key = servingRuntimeCommandKey(record.command);
    withOwnershipMutationLease([servingRuntimesPath(dir)], () => {
      const entries = readServingRuntimes(dir);
      const updated = entries.map(entry => {
        if (servingRuntimeCommandKey(entry.command) !== key) return entry;
        if (entry.servedAt !== record.servedAt) return entry;
        const failedCount = Math.min((entry.delegation?.failedCount ?? 0) + 1, DELEGATION_FAILURE_COUNT_CAP);
        return { ...entry, delegation: { lastFailedAt: new Date(now()).toISOString(), failedCount } };
      });
      if (updated.every((entry, index) => entry === entries[index])) return;
      writeServingRuntimes(updated, dir);
    });
  } catch { /* census loss must never fail a start */ }
}

/**
 * Drop a recorded install's delegation-failure marker. Called after a delegated
 * child proves the handoff healthy (clean exit, or it recorded a fresh serve).
 */
export function clearServingRuntimeDelegation(
  record: ServedRuntimeRecord,
  dir: string = getConfigDir(),
): void {
  try {
    assertNotRealHomeUnderTest(dir);
    const key = servingRuntimeCommandKey(record.command);
    withOwnershipMutationLease([servingRuntimesPath(dir)], () => {
      const entries = readServingRuntimes(dir);
      const updated = entries.map(entry =>
        servingRuntimeCommandKey(entry.command) === key && entry.delegation !== undefined
          ? { ...entry, delegation: undefined }
          : entry);
      if (updated.every((entry, index) => entry === entries[index])) return;
      writeServingRuntimes(updated, dir);
    });
  } catch { /* census loss must never fail a start */ }
}

export interface SyncRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type SyncRunner = (file: string, args: readonly string[]) => SyncRunResult;

function bufferedSyncRunner(file: string, args: readonly string[]): SyncRunResult {
  const result = spawnSync(file, [...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: RUNTIME_VERSION_PROBE_TIMEOUT_MS,
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/**
 * Extract the strict semver a binary reports for `--version`, or null when it cannot be
 * asked. The probe is the re-verification step: a census record survives the binary it
 * described (a rollback, a partial uninstall), so the version on record alone never
 * authorizes a handoff.
 */
export function probeServedRuntimeVersion(
  command: readonly string[],
  run: SyncRunner = bufferedSyncRunner,
): string | null {
  if (command.length === 0) return null;
  let result: SyncRunResult;
  try {
    result = run(command[0]!, [...command.slice(1), "--version"]);
  } catch {
    return null;
  }
  if (result.status !== 0) return null;
  // printVersion() emits "opencodex X.Y.Z"; accept the strict-semver token wherever it lands.
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/.exec(result.stdout);
  if (!match) return null;
  return parseStrictSemver(match[1])?.raw ?? null;
}

export interface NewerServingRuntimeDeps {
  readonly dir?: string;
  readonly exists?: (path: string) => boolean;
  readonly run?: SyncRunner;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

/**
 * The newest recorded install that can actually replace this one, or null.
 *
 * "Recorded" alone never suffices: the probe re-asks the binary for its version, so a
 * record left behind by a replaced or partially removed install demotes itself instead of
 * handing the port to a stale executable. Candidates probe best-recorded-version first
 * and a dead or demoting candidate falls through to the next one — a rolled-back top
 * record must not keep a good install beneath it from serving. Self is excluded by
 * command identity, not by version, so an equal-version sibling is never a candidate.
 */
export function selectNewerServingRuntime(
  selfVersion: string,
  selfCommand: readonly string[],
  deps: NewerServingRuntimeDeps = {},
): ServedRuntimeRecord | null {
  const self = parseStrictSemver(selfVersion);
  if (self === null) return null;
  const exists = deps.exists ?? existsSync;
  const now = deps.now ?? Date.now;
  const selfKey = servingRuntimeCommandKey(selfCommand);
  const candidates = readServingRuntimes(deps.dir ?? getConfigDir())
    .filter(record => servingRuntimeCommandKey(record.command) !== selfKey)
    .filter(record => {
      const recorded = parseStrictSemver(record.version);
      return recorded !== null && compareStrictSemver(recorded, self) > 0;
    })
    .filter(record => record.command.every(part => exists(part)))
    .filter(record => {
      const failedCount = record.delegation?.failedCount ?? 0;
      if (failedCount <= 0) return true;
      const failedAt = Date.parse(record.delegation?.lastFailedAt ?? "");
      // A marker without a usable timestamp cannot prove a live cooldown; the
      // candidate gets one probe and a fresh mark on another failure.
      if (!Number.isFinite(failedAt)) return true;
      const cooldownMs = Math.min(failedCount, DELEGATION_FAILURE_COUNT_CAP) * DELEGATION_FAILURE_COOLDOWN_MS;
      if (now() - failedAt >= cooldownMs) return true;
      deps.log?.(
        `⏭️  Skipping ${record.command.join(" ")} (${record.version}): its last ${failedCount} delegated start${failedCount === 1 ? "" : "s"} died before serving; retry after ${new Date(failedAt + cooldownMs).toISOString()}.`,
      );
      return false;
    })
    .sort((left, right) => compareStrictSemver(parseStrictSemver(right.version)!, parseStrictSemver(left.version)!));
  let probes = 0;
  for (const record of candidates) {
    if (probes >= MAX_VERSION_PROBE_ATTEMPTS) break;
    probes += 1;
    const probed = probeServedRuntimeVersion(record.command, deps.run);
    const probedSemver = probed === null ? null : parseStrictSemver(probed);
    if (probedSemver === null || compareStrictSemver(probedSemver, self) <= 0) continue;
    return { ...record, version: probed! };
  }
  return null;
}

export interface DeferToNewerRuntimeDeps extends NewerServingRuntimeDeps {
  readonly runInherited?: (command: readonly string[], args: readonly string[]) => Promise<number>;
}

/**
 * Time a delegated child gets to finish shutting down after this parent takes a
 * termination signal, before escalation to SIGKILL. The parent waits for the child
 * to exit; repeated signals share one timer, which is cleared when that wait ends.
 */
const DELEGATED_SIGNAL_GRACE_MS = 5_000;

/**
 * Run the delegated install in the foreground and wait for its exit.
 *
 * The service manager tracks THIS process, so termination must reach the child:
 * signals are forwarded, and a parent exit (including a manager kill that never
 * signals the child) still terminates it through the exit hook. A manager that
 * force-kills the parent without a signal remains the one uncovered case — the
 * port-holding child then outlives the registration, which the next service start
 * sees through the usual live-owner path.
 */
async function inheritedRunner(command: readonly string[], args: readonly string[]): Promise<number> {
  const child = spawn(command[0]!, [...command.slice(1), ...args], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
  const terminateChild = () => { try { child.kill(); } catch { /* already gone */ } };
  const forceKillChild = () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const forward = (signal: NodeJS.Signals) => () => {
    try { child.kill(signal); } catch { /* already gone */ }
    escalation ??= setTimeout(forceKillChild, DELEGATED_SIGNAL_GRACE_MS);
    escalation.unref();
  };
  const onSigint = forward("SIGINT");
  const onSigterm = forward("SIGTERM");
  const onSighup = forward("SIGHUP");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGHUP", onSighup);
  process.on("exit", terminateChild);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(
        signal === null ? (code ?? 1) : 128 + (osConstants.signals[signal] ?? 1),
      ));
    });
  } finally {
    if (escalation) clearTimeout(escalation);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("SIGHUP", onSighup);
    process.off("exit", terminateChild);
  }
}

/**
 * Hand this service child's serve to a strictly newer recorded install.
 *
 * Resolves to the delegated child's exit code when a handoff happened, null when this
 * process should serve itself. The foreground wait keeps the service contract intact:
 * the wrapper sees the real child's exit (including the stay-out code) and restart
 * ownership stays exactly where the manager put it. Only called on the managed-service
 * path — an interactive `ocx start` already picked its binary on PATH.
 */
export async function deferToNewerServiceRuntime(
  selfVersion: string,
  selfCommand: readonly string[],
  port: number | undefined,
  deps: DeferToNewerRuntimeDeps = {},
): Promise<number | null> {
  const log = deps.log ?? (line => console.log(line));
  const candidate = selectNewerServingRuntime(selfVersion, selfCommand, deps);
  if (candidate === null) return null;
  const startArgs = ["start"];
  if (port !== undefined && Number.isFinite(port) && port > 0 && port <= 65535) {
    startArgs.push("--port", String(Math.trunc(port)));
  }
  const run = deps.runInherited ?? inheritedRunner;
  log(
    `⚠️  This install (${selfVersion}) is older than the runtime that last served this home (${candidate.version}). `
    + `Deferring to ${candidate.command.join(" ")} so the service does not silently downgrade.`,
  );
  const dir = deps.dir ?? getConfigDir();
  let code: number;
  try {
    code = await run(candidate.command, startArgs);
  } catch (error) {
    markServingRuntimeDelegationFailed(candidate, dir, deps.now);
    log(`⚠️  Newer runtime failed to launch (${error instanceof Error ? error.message : String(error)}); serving this install instead.`);
    return null;
  }
  if (code === 0) {
    clearServingRuntimeDelegation(candidate, dir);
    return code;
  }
  // A nonzero exit only counts as a delegation failure when the child never
  // recorded itself: a refreshed servedAt means it did reach the bind boundary,
  // and the death belongs to whatever killed a live server, not to the handoff.
  const latest = readServingRuntimes(dir)
    .find(entry => servingRuntimeCommandKey(entry.command) === servingRuntimeCommandKey(candidate.command));
  if (latest !== undefined && latest.servedAt === candidate.servedAt) {
    markServingRuntimeDelegationFailed(candidate, dir, deps.now);
  } else {
    clearServingRuntimeDelegation(candidate, dir);
  }
  return code;
}

/**
 * The `handleStart` gate: only a service child defers, and only before it binds.
 * A sibling owns nothing shared, and an interactive start picked its binary on PATH.
 * `OCX_SERVICE=1` alone is not the contract: the same flag reaches foreground
 * claude/opencode children the proxy spawns, and those must never hand their
 * process to another install. Managed children prove themselves with
 * `OCX_SERVICE_MANAGED=1`; on Windows the wrapper proves it with the
 * `OCX_WINDOWS_WRAPPER_PROTOCOL=1` marker on top of `OCX_SERVICE=1`.
 */
export async function deferServiceChildToNewerRuntime(options: {
  readonly sibling: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly selfVersion: string;
  readonly selfCommand: readonly string[];
  readonly port?: number;
  readonly deps?: DeferToNewerRuntimeDeps;
}): Promise<number | null> {
  if (options.sibling
    || (options.env.OCX_SERVICE_MANAGED !== "1"
      && !(options.env.OCX_SERVICE === "1" && options.env[WINDOWS_WRAPPER_PROTOCOL_ENV] === "1"))) {
    return null;
  }
  return deferToNewerServiceRuntime(options.selfVersion, options.selfCommand, options.port, options.deps);
}
