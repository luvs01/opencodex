import { useT, type TKey } from "../i18n";
import { IconAlert, IconRefresh } from "../icons";
import { useCodexCliUpdate } from "./use-codex-cli-update";

function refusalKey(reason: string | null): TKey {
  switch (reason) {
    case "windows_apply_disabled": return "cliUpdate.windows";
    case "windows_inspection_deferred": return "cliUpdate.deferred";
    case "not_managed": return "cliUpdate.notManaged";
    case "already_current": return "cliUpdate.current";
    case "blocked_active_session": return "cliUpdate.activeSession";
    case "blocked_process_state_unknown": return "cliUpdate.unknownSession";
    case "plan_changed": case "installation_changed": return "cliUpdate.stale";
    case "installation_busy": return "cliUpdate.installBusy";
    default: return "cliUpdate.unavailable";
  }
}
const jobKeys = { queued: "cliUpdate.queued", running: "cliUpdate.running", applied: "cliUpdate.applied",
  not_applied: "cliUpdate.notApplied", refused: "cliUpdate.refused", ambiguous: "cliUpdate.unknown" } as const;

export function CodexCliUpdatePanel({ apiBase, active, readOnly = false }: { apiBase: string; active: boolean; readOnly?: boolean }) {
  const t = useT();
  const state = useCodexCliUpdate(apiBase, active);
  const { plan, job, attempt, busy, error, unavailable } = state;
  const recover = !!attempt && !attempt.jobId;
  const eligible = !readOnly && !unavailable && (recover || (!attempt && plan?.applicable));
  return <section className="update-box" aria-labelledby="codex-cli-update-title" aria-busy={!!busy}>
    <h4 id="codex-cli-update-title">{t("cliUpdate.title")}</h4>
    <p className="muted text-label">{t("cliUpdate.description")}</p>
    <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || !!attempt || unavailable}
      onClick={() => { void state.checkPlan(); }}><IconRefresh />{t(busy === "plan" ? "cliUpdate.checking" : "cliUpdate.check")}</button>
    {plan && <>
      <dl className="update-box">
        <div className="spread"><dt>{t("dash.updateInstalled")}</dt><dd className="mono">{plan.installedVersion ?? "—"}</dd></div>
        <div className="spread"><dt>{t("cliUpdate.target")}</dt><dd className="mono">{plan.targetVersion ?? "—"}</dd></div>
        <div className="spread"><dt>{t("cliUpdate.ownership")}</dt><dd>{t(plan.managed ? "cliUpdate.managed" : "cliUpdate.notManaged")}</dd></div>
      </dl>
      <p className="muted text-label" role="status">{t(plan.applicable ? "cliUpdate.ready"
        : plan.provenance === "app-bundle" ? "cliUpdate.appBundle" : refusalKey(plan.refusal))}</p>
    </>}
    {job && <div className={`notice ${job.status === "applied" ? "notice-ok" : "notice-warn"}`} role="status" aria-live="polite">
      <span>{t(jobKeys[job.status])}{job.status === "refused" && job.reason ? ` ${t(refusalKey(job.reason))}` : ""}</span>
    </div>}
    {(unavailable || error) && <div className="notice notice-warn" role="status"><IconAlert /><span>
      {t(unavailable ? "cliUpdate.storageUnavailable" : error === "plan" ? "cliUpdate.planFailed"
        : error === "request" ? "cliUpdate.requestUnknown" : "cliUpdate.statusFailed")}
    </span></div>}
    {recover && !error && <p className="muted text-label" role="status">{t("cliUpdate.requestUnknown")}</p>}
    {attempt?.jobId && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy}
      onClick={() => { void state.refreshStatus(); }}>{t("cliUpdate.refresh")}</button>}
    {readOnly && <p className="muted text-label">{t("cliUpdate.localOnly")}</p>}
    {eligible && <>
      <label className="checkbox"><input type="checkbox" checked={state.confirmed} disabled={!!busy}
        onChange={event => state.setConfirmation(event.currentTarget.checked)} />{t(recover ? "cliUpdate.confirmRecover" : "cliUpdate.confirm")}</label>
      <button type="button" className="btn btn-primary" disabled={!!busy || !state.confirmed}
        onClick={() => { void state.apply(); }}>{t(recover ? "cliUpdate.recover" : "cliUpdate.apply")}</button>
    </>}
    <p className="muted text-label">{t("cliUpdate.lifetime")}</p>
  </section>;
}
