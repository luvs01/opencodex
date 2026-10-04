import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OcxConfig } from "../../src/types";
import {
  resolveCodexAuthContext, materializeCodexUpstreamAuth, applyCodexAuthContextToProvider,
  assertCodexAuthContextNotCooled, CodexPoolAccountCreditsOffError,
  cooldownErrorMessage, shouldMarkAccountNeedsReauthForCodexAuthFailure,
} from "../../src/codex/auth-context";
import { saveCodexAccountCredential } from "../../src/codex/account-store";
import { isAccountNeedsReauth } from "../../src/codex/account-runtime-state";
import { clearAccountNeedsReauth, clearAccountQuota, updateAccountQuota } from "../../src/codex/auth-api";
import { setAccountQuotaFromParsed } from "../../src/codex/quota";
import { clearCodexUpstreamHealth, clearThreadAccountMap } from "../../src/codex/routing";
import { clearPoolRotationState } from "../../src/codex/pool-rotation";
import { setAsyncIcaclsRunnerForTests, setIcaclsRunnerForTests } from "../../src/lib/windows-secret-acl";
import { flushConfigDirHardeningForTests } from "../../src/config/paths";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const ID = "credit-policy-fixture";
const ICACLS_OK = { success: true, exitCode: 0, timedOut: false, stdout: "" };
let dir = "";
let previousHome: string | undefined;
let previousCodexHome: string | undefined;

function config(): OcxConfig {
  return {
    providers: {}, port: 10100, hostname: "127.0.0.1", codexMainAccountHardLock: false,
    codexAccounts: [{ id: ID, email: "fixture@example.test", isMain: false, plan: "pro" }],
    creditCodexAccountIds: [], activeCodexAccountId: ID, autoSwitchThreshold: 0,
    upstreamFailoverThreshold: 3,
  } as OcxConfig;
}
function quota(percent = 100, resetAt = Date.now() + 3_600_000): void {
  updateAccountQuota(ID, percent, resetAt);
  setAccountQuotaFromParsed(ID, { credits: { hasCredits: true, balance: 42.5, observedAt: Date.now() } });
}
const resolve = (cfg: OcxConfig) => resolveCodexAuthContext(new Headers(), cfg, "pool", { accountId: ID, modelId: "gpt-5.5" });

describe("stored-account credit policy at authentication", () => {
  beforeEach(() => {
    previousHome = process.env.OPENCODEX_HOME;
    previousCodexHome = process.env.CODEX_HOME;
    dir = mkdtempSync(join(tmpdir(), "ocx-pool-credit-policy-"));
    process.env.OPENCODEX_HOME = dir;
    process.env.CODEX_HOME = dir;
    setIcaclsRunnerForTests(() => ICACLS_OK);
    setAsyncIcaclsRunnerForTests(async () => ICACLS_OK);
    clearAccountQuota(); clearCodexUpstreamHealth(); clearThreadAccountMap(); clearPoolRotationState();
    clearAccountNeedsReauth(ID);
    saveCodexAccountCredential(ID, {
      accessToken: "access-token-value-credit-policy", refreshToken: "fixture-refresh-credit-policy",
      expiresAt: Date.now() + 3_600_000, chatgptAccountId: "fixture-workspace-credit-policy",
    });
  });
  afterEach(async () => {
    try {
      clearAccountQuota(); clearCodexUpstreamHealth(); clearThreadAccountMap(); clearPoolRotationState();
      clearAccountNeedsReauth(ID);
      await flushConfigDirHardeningForTests();
    } finally {
      setIcaclsRunnerForTests(null); setAsyncIcaclsRunnerForTests(null);
      if (previousHome === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previousHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome;
      if (dir) removeTreeWithRetry(dir);
      dir = "";
    }
  });
  test("an exact selector respects the credits-off hold without quarantining the account", async () => {
    quota();
    await expect(resolve(config())).rejects.toBeInstanceOf(CodexPoolAccountCreditsOffError);
    expect(isAccountNeedsReauth(ID)).toBe(false);
  });
  test("explicit opt-in with current spendable evidence still materializes the selected credential", async () => {
    const cfg = config(); cfg.creditCodexAccountIds = [ID]; quota();
    const ctx = await resolve(cfg);
    expect(ctx.kind).toBe("pool");
    expect(materializeCodexUpstreamAuth(new Headers(), ctx).get("authorization")).toBe("Bearer access-token-value-credit-policy");
  });
  test("a below-limit exact account remains usable", async () => {
    quota(99);
    expect((await resolve(config())).kind).toBe("pool");
  });
  test("a later full window is checked even when materialization options omit config", async () => {
    quota(99); const ctx = await resolve(config()); quota();
    expect(() => materializeCodexUpstreamAuth(new Headers(), ctx)).toThrow(CodexPoolAccountCreditsOffError);
  });
  test("provider overrides recheck the same live policy", async () => {
    const cfg = config(); cfg.creditCodexAccountIds = [ID]; quota();
    const ctx = await resolve(cfg); cfg.creditCodexAccountIds = [];
    expect(() => applyCodexAuthContextToProvider({ adapter: "openai-responses", baseUrl: "https://example.test", authMode: "forward" }, ctx, "pool"))
      .toThrow(CodexPoolAccountCreditsOffError);
  });
  test("a recovery probe does not grant credit-spending permission", async () => {
    quota(99); const ctx = await resolve(config());
    if (ctx.kind !== "pool") throw new Error("expected pool fixture");
    ctx.probeLeaseId = "fixture-probe"; quota();
    expect(() => assertCodexAuthContextNotCooled(ctx)).toThrow(CodexPoolAccountCreditsOffError);
  });
  test("an explicit current materialization policy takes precedence", async () => {
    const cfg = config(); cfg.creditCodexAccountIds = [ID]; quota();
    const ctx = await resolve(cfg);
    expect(() => materializeCodexUpstreamAuth(new Headers(), ctx, { config: { creditCodexAccountIds: [] } }))
      .toThrow(CodexPoolAccountCreditsOffError);
  });
  test("an elapsed full window does not hold the account indefinitely", async () => {
    quota(100, Date.now() - 1_000);
    expect((await resolve(config())).kind).toBe("pool");
  });
  test("policy refusal retains actionable wording and is not a reauthentication failure", () => {
    const error = new CodexPoolAccountCreditsOffError(ID, Date.now() + 3_600_000);
    expect(shouldMarkAccountNeedsReauthForCodexAuthFailure(error)).toBe(false);
    expect(cooldownErrorMessage(error)).toBe(error.message);
    expect(error.message).not.toContain(ID);
    expect(error.message).not.toContain("clear-cooldown");
  });
});
