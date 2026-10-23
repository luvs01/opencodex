import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { CodexCliUpdatePanel } from "../src/components/CodexCliUpdatePanel";
import { parseCliUpdateJob, parseCliUpdatePlan, readCliUpdateAttempt, saveCliUpdateAttempt, settleCliUpdateAttempt } from "../src/components/codex-cli-update-state";
import { LanguageProvider } from "../src/i18n/provider";

const PLAN = "a".repeat(32), JOB = "11111111-1111-4111-8111-111111111111";
const globals = ["document", "window", "navigator", "localStorage", "sessionStorage", "IS_REACT_ACT_ENVIRONMENT",
  "fetch", "setTimeout", "clearTimeout"] as const;
let previous: Record<string, PropertyDescriptor | undefined>;
let win: Window, host: HTMLElement, root: Root | null;
let requests: { url: string; init?: RequestInit }[];
let handler: (url: string, init?: RequestInit) => Response | Promise<Response>;
let timers: Map<number, () => void>;
const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;

function plan(extra: Record<string, unknown> = {}) {
  return { schemaVersion: 1, package: "@openai/codex", applicable: true, planId: PLAN, managed: true,
    provenance: "npm-global", installedVersion: "1.2.3", targetVersion: "1.2.4", refusal: null,
    session: { state: "none", matches: 0 }, location: "/private/not-for-display", targetIntegrity: "secret-integrity",
    command: ["private-argv"], inspectionEnv: "private-env", ...extra };
}
function job(status = "queued", extra: Record<string, unknown> = {}) {
  const live = status === "queued" || status === "running";
  return { jobId: JOB, planId: PLAN, status, ownerState: live ? "active" : "finished", lifetimeUncertain: false,
    childState: live ? "not_started" : status === "refused" ? "not_started" : "terminal",
    leaseState: live ? "unknown" : "not_acquired_or_released", outcome: live ? null : status,
    reason: null, cleanupErrors: [], ...extra };
}
beforeEach(() => {
  previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  win = new Window({ url: "http://localhost" });
  win.localStorage.setItem("ocx-lang", "en");
  host = win.document.createElement("div") as unknown as HTMLElement; win.document.body.append(host);
  requests = []; timers = new Map(); root = null;
  handler = (url, init) => url.endsWith("/plan") ? Response.json(plan())
    : init?.method === "POST" ? Response.json({ job: job() }, { status: 202 }) : Response.json(job("applied"));
  let timerId = 0;
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: win.document }, window: { configurable: true, value: win },
    navigator: { configurable: true, value: win.navigator }, localStorage: { configurable: true, value: win.localStorage },
    sessionStorage: { configurable: true, value: win.sessionStorage }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    fetch: { configurable: true, value: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init }); return handler(String(input), init);
    } },
    setTimeout: { configurable: true, value: ((fn: () => void, ms: number, ...args: unknown[]) => {
      if (ms === 2_000) { const id = ++timerId; timers.set(id, fn); return id; }
      return originalTimeout(fn, ms, ...args);
    }) as typeof setTimeout },
    clearTimeout: { configurable: true, value: ((id: number) => { if (!timers.delete(id)) originalClear(id); }) as typeof clearTimeout },
  });
});
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  await win.happyDOM.close();
  for (const key of globals) {
    const descriptor = previous[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
async function render(active = true, readOnly = false) {
  const { createRoot } = await import("react-dom/client");
  await act(async () => {
    root ??= createRoot(host);
    root.render(<LanguageProvider><CodexCliUpdatePanel apiBase="http://localhost" active={active} readOnly={readOnly} /></LanguageProvider>);
  });
}
const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label)!;
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function confirm() { await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); }); }
async function tick() {
  const [id, callback] = [...timers][0]!; timers.delete(id);
  await act(async () => { callback(); await new Promise(resolve => originalTimeout(resolve, 0)); });
}

test("checking and explicit confirmation are separate; private DTO fields and OpenCodex actions never leak", async () => {
  await render(); expect(requests).toHaveLength(0);
  await click("Check CLI plan");
  expect(button("Apply CLI plan").disabled).toBe(true);
  expect(host.textContent).toContain("1.2.3"); expect(host.textContent).toContain("1.2.4");
  for (const privateValue of ["/private/", "secret-integrity", "private-env", "private-argv", PLAN]) expect(host.textContent).not.toContain(privateValue);
  await confirm(); await click("Apply CLI plan");
  const posted = requests.filter(request => request.init?.method === "POST"); expect(posted).toHaveLength(1);
  expect(posted[0]!.url).toBe("http://localhost/api/codex/cli-update/apply");
  const payload = JSON.parse(String(posted[0]!.init!.body));
  expect(payload).toEqual({ requestId: expect.any(String), planId: PLAN, confirmed: true });
  expect(host.textContent).toContain("CLI update queued"); expect(timers.size).toBe(1);
  await tick(); expect(host.textContent).toContain("CLI update verified as applied"); expect(timers.size).toBe(0);
  expect(requests.every(request => request.url.includes("/api/codex/cli-update/"))).toBe(true);
});

test("lost POST response is never retried automatically and remount recovery reuses the exact confirmed request", async () => {
  handler = (url, init) => { if (init?.method === "POST") throw new Error("private network error"); return Response.json(plan()); };
  await render(); await click("Check CLI plan"); await confirm(); await click("Apply CLI plan");
  const original = String(requests.find(request => request.init?.method === "POST")!.init!.body);
  expect(timers.size).toBe(0); expect(button("Check CLI plan").disabled).toBe(true);
  expect(host.textContent).not.toContain("private network error");
  await act(() => root!.unmount()); root = null; await render();
  expect(requests.filter(request => request.init?.method === "POST")).toHaveLength(1);
  expect(button("Recover original request").disabled).toBe(true);
  handler = () => Response.json({ job: job() }, { status: 202 });
  await confirm(); await click("Recover original request");
  const posts = requests.filter(request => request.init?.method === "POST"); expect(posts).toHaveLength(2);
  expect(String(posts[1]!.init!.body)).toBe(original);
});

test("closing cancels UI polling only; reopening resumes GET status without another POST", async () => {
  await render(); await click("Check CLI plan"); await confirm(); await click("Apply CLI plan");
  expect(timers.size).toBe(1); await render(false); expect(timers.size).toBe(0);
  expect(requests.filter(request => request.init?.method === "DELETE")).toHaveLength(0);
  await render(); expect(timers.size).toBe(1); await tick();
  expect(requests.filter(request => request.init?.method === "POST")).toHaveLength(1);
  expect(host.textContent).toContain("CLI update verified as applied");
});

test("unknown owner/child/lease evidence cannot become success and requires explicit status refresh", async () => {
  handler = (url, init) => url.endsWith("/plan") ? Response.json(plan()) : init?.method === "POST"
    ? Response.json({ job: job() }, { status: 202 })
    : Response.json(job("applied", { ownerState: "unknown", lifetimeUncertain: true, childState: "unknown", leaseState: "unknown" }));
  await render(); await click("Check CLI plan"); await confirm(); await click("Apply CLI plan"); await tick();
  expect(host.textContent).toContain("CLI job outcome is unknown");
  expect(host.textContent).not.toContain("CLI update verified as applied"); expect(timers.size).toBe(0);
  expect(button("Check CLI plan").disabled).toBe(true); expect(button("Refresh CLI job status")).toBeDefined();
});

test("a failed status read stops automatic polling and never clears the original admission", async () => {
  handler = (url, init) => url.endsWith("/plan") ? Response.json(plan()) : init?.method === "POST"
    ? Response.json({ job: job() }, { status: 202 }) : new Response(null, { status: 503 });
  await render(); await click("Check CLI plan"); await confirm(); await click("Apply CLI plan"); await tick();
  expect(host.textContent).toContain("outcome remains unconfirmed"); expect(timers.size).toBe(0);
  expect(button("Check CLI plan").disabled).toBe(true);
  handler = () => Response.json(job("refused", { reason: "plan_changed" }));
  await click("Refresh CLI job status"); expect(host.textContent).toContain("The plan or installation changed");
  expect(button("Check CLI plan").disabled).toBe(false);
});

test.each([
  { provenance: "app-bundle", managed: false, applicable: false, refusal: "not_managed", text: "native app and Store/MSIX" },
  { applicable: false, refusal: "windows_apply_disabled", text: "Windows apply is disabled" },
  { applicable: false, refusal: "blocked_active_session", text: "active Codex session" },
])("ineligible plan is honest and cannot apply: %s", async item => {
  const { text, ...extra } = item; handler = () => Response.json(plan(extra));
  await render(); await click("Check CLI plan"); expect(host.textContent).toContain(text);
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  expect(requests.filter(request => request.init?.method === "POST")).toHaveLength(0);
});

test("read-only dashboard never offers confirmation or Apply", async () => {
  await render(true, true); await click("Check CLI plan");
  expect(host.textContent).toContain("local dashboard confirmation");
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
});

test("DTO validation refuses mismatched jobs and incomplete success; malformed eligibility never enables Apply", () => {
  expect(parseCliUpdatePlan(plan({ planId: null })).applicable).toBe(false);
  expect(parseCliUpdatePlan(plan({ session: { state: "unknown", matches: null } })).applicable).toBe(false);
  expect(() => parseCliUpdateJob(job("applied", { planId: "b".repeat(32) }), PLAN)).toThrow();
  expect(parseCliUpdateJob(job("applied", { cleanupErrors: ["lease_release_unverified"] }), PLAN).status).toBe("ambiguous");
  expect(parseCliUpdateJob(job("applied", { childState: "unknown" }), PLAN).status).toBe("ambiguous");
});

test("late old receipt cannot replace or erase a newer retained admission", () => {
  const newer = { requestId: JOB, planId: PLAN, jobId: null };
  expect(saveCliUpdateAttempt("http://localhost", newer)).toBe(true);
  expect(settleCliUpdateAttempt("http://localhost", "22222222-2222-4222-8222-222222222222", null)).toBe(false);
  expect(readCliUpdateAttempt("http://localhost").attempt).toEqual(newer);
});
