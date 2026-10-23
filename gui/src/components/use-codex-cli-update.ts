import { useCallback, useEffect, useRef, useState } from "react";
import { withFetchDeadline } from "../bounded-fetch";
import { cliUpdateJobPending, cliUpdateJobResolved, parseCliUpdateJob, parseCliUpdatePlan,
  readCliUpdateAttempt, saveCliUpdateAttempt, settleCliUpdateAttempt, type CliUpdateAttempt, type CliUpdateJobView, type CliUpdatePlanView } from "./codex-cli-update-state";

/** Uses the authenticated global fetch installed by the dashboard shell. Never posts from an effect. */
export function useCodexCliUpdate(apiBase: string, active: boolean) {
  const [initial] = useState(() => readCliUpdateAttempt(apiBase));
  const [plan, setPlan] = useState<CliUpdatePlanView | null>(null);
  const [job, setJob] = useState<CliUpdateJobView | null>(null);
  const [attempt, setAttempt] = useState(initial.attempt);
  const [unavailable, setUnavailable] = useState(initial.unavailable);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"plan" | "apply" | "status" | null>(null);
  const [error, setError] = useState<"plan" | "request" | "status" | null>(null);
  const attemptRef = useRef(attempt);
  const planRef = useRef(plan);
  const confirmedRef = useRef(confirmed);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const readAbort = useRef<AbortController | null>(null);
  const visible = useRef(active);
  const setConfirmation = (value: boolean) => { confirmedRef.current = value; setConfirmed(value); };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; visible.current = false; readAbort.current?.abort(); };
  }, []);
  useEffect(() => { visible.current = active; if (!active) readAbort.current?.abort(); }, [active]);

  const checkPlan = useCallback(async () => {
    if (busyRef.current || attemptRef.current || unavailable || !visible.current) return;
    busyRef.current = true; setBusy("plan"); setError(null); setConfirmation(false);
    planRef.current = null; setPlan(null); setJob(null);
    const controller = new AbortController(); readAbort.current = controller;
    try {
      const dto = await withFetchDeadline(15_000, controller.signal, async signal => {
        const response = await fetch(`${apiBase}/api/codex/cli-update/plan`, { signal });
        if (!response.ok) throw new Error("plan_failed");
        return parseCliUpdatePlan(await response.json());
      });
      if (!mounted.current || controller.signal.aborted) return;
      planRef.current = dto; setPlan(dto);
    } catch { if (mounted.current && !controller.signal.aborted) setError("plan"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  }, [apiBase, unavailable]);

  const refreshStatus = useCallback(async () => {
    const current = attemptRef.current;
    if (busyRef.current || !current?.jobId || !visible.current) return;
    busyRef.current = true; setBusy("status"); setError(null);
    const controller = new AbortController(); readAbort.current = controller;
    try {
      const dto = await withFetchDeadline(15_000, controller.signal, async signal => {
        const response = await fetch(`${apiBase}/api/codex/cli-update/jobs/${current.jobId}`, { signal });
        if (!response.ok) throw new Error("status_failed");
        return parseCliUpdateJob(await response.json(), current.planId, current.jobId!);
      });
      if (!mounted.current || controller.signal.aborted || attemptRef.current !== current) return;
      setJob(dto);
      if (cliUpdateJobResolved(dto)) {
        if (!settleCliUpdateAttempt(apiBase, current.requestId, null)) setUnavailable(true);
        attemptRef.current = null; setAttempt(null); planRef.current = null; setPlan(null); setConfirmation(false);
      }
    } catch { if (mounted.current && !controller.signal.aborted) setError("status"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  }, [apiBase]);

  const apply = useCallback(async () => {
    if (busyRef.current || unavailable || !visible.current || !confirmedRef.current) return;
    const existing = attemptRef.current;
    if (existing?.jobId || (!existing && !planRef.current?.applicable)) return;
    const current: CliUpdateAttempt = existing ?? { requestId: crypto.randomUUID(), planId: planRef.current!.planId!, jobId: null };
    // Persist before dispatch. Closing/reloading cannot create a fresh request after a lost reply.
    if (!saveCliUpdateAttempt(apiBase, current)) { setUnavailable(true); return; }
    attemptRef.current = current; setAttempt(current); busyRef.current = true; setBusy("apply"); setError(null); setConfirmation(false);
    try {
      const dto = await withFetchDeadline(15_000, undefined, async signal => {
        const response = await fetch(`${apiBase}/api/codex/cli-update/apply`, { method: "POST", signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: current.requestId, planId: current.planId, confirmed: true }) });
        if (!response.ok) throw new Error("admission_unknown");
        const body = await response.json() as { job?: unknown };
        return parseCliUpdateJob(body.job, current.planId);
      });
      const next = { ...current, jobId: dto.jobId };
      const saved = settleCliUpdateAttempt(apiBase, current.requestId, cliUpdateJobResolved(dto) ? null : next);
      if (!mounted.current) return; // Receipt is retained even after navigation unmounted this hook.
      if (!saved) setUnavailable(true);
      setJob(dto);
      attemptRef.current = cliUpdateJobResolved(dto) ? null : next; setAttempt(attemptRef.current);
      if (cliUpdateJobResolved(dto)) { planRef.current = null; setPlan(null); }
    } catch { if (mounted.current) setError("request"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  }, [apiBase, unavailable]);

  useEffect(() => {
    if (!active || busy || error || !attempt?.jobId || (job && !cliUpdateJobPending(job))) return;
    const timer = setTimeout(() => { void refreshStatus(); }, 2_000);
    return () => clearTimeout(timer);
  }, [active, attempt, job, busy, error, refreshStatus]);

  return { plan, job, attempt, confirmed, setConfirmation, busy, error, unavailable, checkPlan, apply, refreshStatus };
}
