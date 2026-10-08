import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as oauthModule from "../../../src/oauth";
import * as oauthStoreModule from "../../../src/oauth/store";
import * as resetCouponsModule from "../../../src/grok/reset-coupons";
import {
  markGrokResetCouponAttempt,
  openGrokResetCouponOperation,
} from "../../../src/grok/reset-coupon-ledger";
import { handleGrokCouponRoutes } from "../../../src/server/management/grok-coupon-routes";
import type { ManagementContext } from "../../../src/server/management/context";
import type { OcxConfig } from "../../../src/types";

function consumeRequest(operationId: string, tokenId?: string): ManagementContext {
  const url = new URL("http://localhost/api/grok/reset-coupons/consume");
  const req = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: "acc-1", tokenId, operationId }),
  });
  return { req, url, config: {} as OcxConfig, deps: {} as never, version: "test" } as ManagementContext;
}

const TOKEN = { tokenId: "tok-live", validityStart: "2026-01-01T00:00:00Z", validityEnd: "2999-01-01T00:00:00Z" };

describe("grok coupon attempt reconciliation", () => {
  let tempDir = "";
  let previousHome: string | undefined;
  let selectionSpy: ReturnType<typeof spyOn>;
  let snapshotSpy: ReturnType<typeof spyOn>;
  let remainingSpy: ReturnType<typeof spyOn>;
  let redeemSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    previousHome = process.env.OPENCODEX_HOME;
    tempDir = mkdtempSync(join(tmpdir(), "ocx-grok-reconcile-"));
    process.env.OPENCODEX_HOME = tempDir;
    selectionSpy = spyOn(oauthStoreModule, "captureOAuthAccountSelection").mockReturnValue({ accountId: "acc-1" } as never);
    snapshotSpy = spyOn(oauthModule, "getValidAccessSnapshotForAccount").mockResolvedValue({ accessToken: "tok" } as never);
    remainingSpy = spyOn(resetCouponsModule, "getGrokRemainingResets").mockResolvedValue({ tokens: [TOKEN] } as never);
    redeemSpy = spyOn(resetCouponsModule, "redeemGrokResetCoupon").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    selectionSpy.mockRestore();
    snapshotSpy.mockRestore();
    remainingSpy.mockRestore();
    redeemSpy.mockRestore();
    if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
    else process.env.OPENCODEX_HOME = previousHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  const STALE = 120_000;

  it("resumes an interrupted attempt when the coupon is still listed", async () => {
    openGrokResetCouponOperation({ accountId: "acc-1", tokenId: "tok-live", operationId: "11111111-1111-4111-8111-111111111111" });
    markGrokResetCouponAttempt("11111111-1111-4111-8111-111111111111", "tok-live", Date.now() - STALE);

    const res = await handleGrokCouponRoutes(consumeRequest("11111111-1111-4111-8111-111111111111", "tok-live"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body.code).toBe("redeemed");
    // The spend actually fired this time — not a phantom replay.
    expect(redeemSpy).toHaveBeenCalledTimes(1);

    const settled = openGrokResetCouponOperation({ accountId: "acc-1", tokenId: "tok-live", operationId: "11111111-1111-4111-8111-111111111111" });
    expect(settled.code).toBe("redeemed");
  });

  it("settles an interrupted attempt as redeemed when the token is gone but still in-window", async () => {
    openGrokResetCouponOperation({ accountId: "acc-1", tokenId: "tok-live", operationId: "22222222-2222-4222-8222-222222222222" });
    markGrokResetCouponAttempt("22222222-2222-4222-8222-222222222222", "tok-live", Date.now() - STALE, undefined, Date.now() + 86_400_000);
    remainingSpy.mockResolvedValue({ tokens: [] } as never);

    const res = await handleGrokCouponRoutes(consumeRequest("22222222-2222-4222-8222-222222222222", "tok-live"));
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body.code).toBe("redeemed");
    expect(redeemSpy).not.toHaveBeenCalled();
  });

  it("reports attempt_unresolved when the token lapsed during an interrupted attempt", async () => {
    openGrokResetCouponOperation({ accountId: "acc-1", tokenId: "tok-live", operationId: "33333333-3333-4333-8333-333333333333" });
    markGrokResetCouponAttempt("33333333-3333-4333-8333-333333333333", "tok-live", Date.now() - 3_600_000, undefined, Date.now() - 60_000);
    remainingSpy.mockResolvedValue({ tokens: [] } as never);

    const res = await handleGrokCouponRoutes(consumeRequest("33333333-3333-4333-8333-333333333333", "tok-live"));
    expect(res!.status).toBe(409);
    const body = await res!.json();
    expect(body.error.code).toBe("attempt_unresolved");
    expect(redeemSpy).not.toHaveBeenCalled();
  });

  it("refuses to resume an attempt that may still be in flight", async () => {
    openGrokResetCouponOperation({ accountId: "acc-1", tokenId: "tok-live", operationId: "55555555-5555-4555-8555-555555555555" });
    markGrokResetCouponAttempt("55555555-5555-4555-8555-555555555555", "tok-live");

    const res = await handleGrokCouponRoutes(consumeRequest("55555555-5555-4555-8555-555555555555", "tok-live"));
    expect(res!.status).toBe(409);
    const body = await res!.json();
    expect(body.error.code).toBe("attempt_in_progress");
    // No upstream calls at all — the in-flight window is checked first.
    expect(remainingSpy).not.toHaveBeenCalled();
    expect(redeemSpy).not.toHaveBeenCalled();
  });

  it("rejects a retry that names a different coupon than the recorded attempt", async () => {
    openGrokResetCouponOperation({ accountId: "acc-1", tokenId: "tok-live", operationId: "66666666-6666-4666-8666-666666666666" });
    markGrokResetCouponAttempt("66666666-6666-4666-8666-666666666666", "tok-live", Date.now() - STALE);

    const res = await handleGrokCouponRoutes(consumeRequest("66666666-6666-4666-8666-666666666666", "tok-other"));
    expect(res!.status).toBe(409);
    const body = await res!.json();
    expect(body.error.code).toBe("operation_token_mismatch");
    expect(redeemSpy).not.toHaveBeenCalled();
  });

  it("rejects a requested coupon that is no longer listed upstream", async () => {
    const res = await handleGrokCouponRoutes(consumeRequest("44444444-4444-4444-8444-444444444444", "tok-stale"));
    expect(res!.status).toBe(409);
    const body = await res!.json();
    expect(body.error.code).toBe("coupon_unavailable");
    expect(redeemSpy).not.toHaveBeenCalled();
  });
});
