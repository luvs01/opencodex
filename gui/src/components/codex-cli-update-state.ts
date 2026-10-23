/** Dashboard projections deliberately discard paths, argv, integrity and private inspection inputs. */
export interface CliUpdatePlanView {
  applicable: boolean; planId: string | null; managed: boolean;
  provenance: "npm-global" | "app-bundle" | "version-manager" | "standalone-unverified" | "unknown";
  installedVersion: string | null; targetVersion: string | null; refusal: string | null;
}
export interface CliUpdateJobView {
  jobId: string; planId: string;
  status: "queued" | "running" | "applied" | "not_applied" | "refused" | "ambiguous";
  reason: string | null;
}
export interface CliUpdateAttempt { requestId: string; planId: string; jobId: string | null }
const PLAN_ID = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const version = (value: unknown): string | null => typeof value === "string"
  && value.length <= 96 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value) ? value : null;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const REASONS = new Set(["windows_apply_disabled", "windows_inspection_deferred", "not_managed", "installed_version_unverified",
  "install_content_unverified", "target_unresolved", "already_current", "target_not_newer", "blocked_active_session",
  "blocked_process_state_unknown", "plan_changed", "installation_changed", "installation_busy"]);
const reason = (value: unknown): string | null => typeof value === "string" && REASONS.has(value) ? value : null;

export function parseCliUpdatePlan(value: unknown): CliUpdatePlanView {
  const dto = record(value);
  if (!dto || dto.schemaVersion !== 1 || dto.package !== "@openai/codex" || typeof dto.managed !== "boolean"
    || typeof dto.applicable !== "boolean") throw new Error("invalid_plan");
  const provenance = ["npm-global", "app-bundle", "version-manager", "standalone-unverified"].includes(String(dto.provenance))
    ? dto.provenance as CliUpdatePlanView["provenance"] : "unknown";
  const planId = typeof dto.planId === "string" && PLAN_ID.test(dto.planId) ? dto.planId : null;
  const installedVersion = version(dto.installedVersion), targetVersion = version(dto.targetVersion);
  const session = record(dto.session);
  return { planId, installedVersion, targetVersion, provenance, managed: dto.managed,
    refusal: reason(dto.refusal), applicable: dto.applicable && dto.managed && provenance === "npm-global"
      && !!planId && !!installedVersion && !!targetVersion && dto.refusal === null
      && session?.state === "none" && session.matches === 0 };
}

export function parseCliUpdateJob(value: unknown, expectedPlanId: string, expectedJobId?: string): CliUpdateJobView {
  const dto = record(value);
  if (!dto || typeof dto.jobId !== "string" || !UUID.test(dto.jobId) || dto.planId !== expectedPlanId
    || (expectedJobId !== undefined && dto.jobId !== expectedJobId)
    || !["queued", "running", "applied", "not_applied", "refused", "ambiguous"].includes(String(dto.status))) {
    throw new Error("invalid_job");
  }
  let status = dto.status as CliUpdateJobView["status"];
  const live = status === "queued" || status === "running";
  const terminal = !live && status !== "ambiguous";
  // A success-looking status never outranks unknown owner, child or lease evidence.
  if (dto.lifetimeUncertain !== false || dto.ownerState === "unknown"
    || (live && dto.ownerState !== "active")
    || (terminal && (dto.ownerState !== "finished" || dto.outcome !== status
      || dto.leaseState !== "not_acquired_or_released" || !Array.isArray(dto.cleanupErrors) || dto.cleanupErrors.length !== 0
      || dto.childState !== (status === "refused" ? "not_started" : "terminal")))) status = "ambiguous";
  return { jobId: dto.jobId, planId: expectedPlanId, status, reason: reason(dto.reason) };
}
export const cliUpdateJobPending = (job: CliUpdateJobView): boolean => job.status === "queued" || job.status === "running";
export const cliUpdateJobResolved = (job: CliUpdateJobView): boolean => !cliUpdateJobPending(job) && job.status !== "ambiguous";

const storageKey = (apiBase: string) => `ocx.codex-cli-update.pending.v1:${apiBase}`;
export function readCliUpdateAttempt(apiBase: string): { attempt: CliUpdateAttempt | null; unavailable: boolean } {
  try {
    const raw = sessionStorage.getItem(storageKey(apiBase));
    if (!raw) return { attempt: null, unavailable: false };
    const dto = record(JSON.parse(raw));
    if (!dto || typeof dto.requestId !== "string" || !UUID.test(dto.requestId)
      || typeof dto.planId !== "string" || !PLAN_ID.test(dto.planId)
      || (dto.jobId !== null && (typeof dto.jobId !== "string" || !UUID.test(dto.jobId)))) throw new Error("invalid_attempt");
    return { attempt: { requestId: dto.requestId, planId: dto.planId, jobId: dto.jobId as string | null }, unavailable: false };
  } catch { return { attempt: null, unavailable: true }; }
}
export function saveCliUpdateAttempt(apiBase: string, attempt: CliUpdateAttempt): boolean {
  try { sessionStorage.setItem(storageKey(apiBase), JSON.stringify(attempt)); return true; } catch { return false; }
}
/** A late reply from an unmounted dialog must never erase a newer confirmed request. */
export function settleCliUpdateAttempt(apiBase: string, requestId: string, next: CliUpdateAttempt | null): boolean {
  const current = readCliUpdateAttempt(apiBase);
  if (current.unavailable || current.attempt?.requestId !== requestId) return false;
  try {
    if (next) sessionStorage.setItem(storageKey(apiBase), JSON.stringify(next));
    else sessionStorage.removeItem(storageKey(apiBase));
    return true;
  } catch { return false; }
}
