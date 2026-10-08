/**
 * Management API handlers for Grok quota reset coupons.
 *
 * Exposes inspection and consumption of Grok billing reset coupons via gRPC-Web
 * to Grok ConsumerUiSvc upstream endpoints.
 *
 * Inherits management authentication from requireManagementAuth in management-api.ts.
 * Lazy-loaded by handleGrokCouponRoutesOnDemand to keep startup fast and honor the
 * core-lab boundary contract.
 */

import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { isCodexResetCreditOperationId } from "../../codex/reset-credit-recovery";
import { getValidAccessSnapshotForAccount } from "../../oauth";
import { listAccounts, captureOAuthAccountSelection } from "../../oauth/store";
import {
  getGrokRemainingResets,
  redeemGrokResetCoupon,
  type GrokResetCoupon,
} from "../../grok/reset-coupons";
import {
  markGrokResetCouponAttempt,
  openGrokResetCouponOperation,
  recordGrokResetCouponSettlement,
  type GrokResetCouponOperationRecord,
} from "../../grok/reset-coupon-ledger";

export interface GrokResetCouponsResponse {
  accountId: string;
  tokens: Array<{
    tokenId: string;
    validityStart: string;
    validityEnd: string;
  }>;
  remaining: number;
}

export interface GrokConsumeCouponRequestBody {
  accountId?: string;
  tokenId?: string;
  operationId?: string;
}

// An "attempted" operation younger than this may still be in flight in the
// request that marked it — resuming it would send a second spend upstream.
// Generous vs the upstream redeem call's own timeout; a crashed request is
// stranded past the window and only then resumable.
const GROK_COUPON_ATTEMPT_STALE_MS = 90_000;

// Single-process spend exclusion: the ledger marks are advisory file writes,
// not held locks, so a stale-window resume could otherwise run while the
// ORIGINAL request's upstream spend is still in flight (e.g. a hung redeem
// outliving the window). Any second request for the same operationId gets
// attempt_in_progress while the first holds this set — only a genuinely
// dead attempt can ever resume.
const grokCouponInFlightAttempts = new Set<string>();

function resolveTargetAccountId(requestedAccountId?: string): string {
  if (requestedAccountId && requestedAccountId.trim() !== "") {
    return requestedAccountId.trim();
  }
  const selection = captureOAuthAccountSelection("xai");
  if (selection?.accountId) {
    return selection.accountId;
  }
  const accounts = listAccounts("xai");
  if (accounts.length > 0) {
    return accounts[0].id;
  }
  throw new Error("No xAI account found or active");
}

export async function handleGrokCouponRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { url, req, config } = ctx;
  const { pathname } = url;

  if (pathname === "/api/grok/reset-coupons") {
    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, req, config);
    }

    const queryAccountId = url.searchParams.get("accountId") ?? undefined;
    let accountId: string;
    try {
      accountId = resolveTargetAccountId(queryAccountId);
    } catch (err) {
      return jsonResponse(
        { error: { code: "no_account", message: err instanceof Error ? err.message : String(err) } },
        400,
        req,
        config,
      );
    }

    let tokenSnapshot;
    try {
      tokenSnapshot = await getValidAccessSnapshotForAccount("xai", accountId, { requireUsableAccount: true });
    } catch (err) {
      return jsonResponse(
        { error: { code: "auth_failed", message: "Failed to resolve valid xAI credentials for account" } },
        401,
        req,
        config,
      );
    }

    try {
      const remainingResult = await getGrokRemainingResets({
        accessToken: tokenSnapshot.accessToken,
      });

      const payload: GrokResetCouponsResponse = {
        accountId,
        tokens: remainingResult.tokens.map((t) => ({
          tokenId: t.tokenId,
          validityStart: t.validityStart,
          validityEnd: t.validityEnd,
        })),
        remaining: remainingResult.tokens.length,
      };

      return jsonResponse(payload, 200, req, config);
    } catch (err) {
      return jsonResponse(
        { error: { code: "upstream_error", message: err instanceof Error ? err.message : String(err) } },
        502,
        req,
        config,
      );
    }
  }

  if (pathname === "/api/grok/reset-coupons/consume") {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, req, config);
    }

    let body: GrokConsumeCouponRequestBody;
    try {
      body = (await req.json()) as GrokConsumeCouponRequestBody;
    } catch {
      return jsonResponse({ error: { code: "invalid_json", message: "Invalid JSON body" } }, 400, req, config);
    }

    const { accountId: rawAccountId, tokenId: requestedTokenId, operationId } = body;

    if (operationId !== undefined && !isCodexResetCreditOperationId(operationId)) {
      return jsonResponse(
        { error: { code: "invalid_operation_id", message: "operationId must be a valid UUIDv4" } },
        400,
        req,
        config,
      );
    }

    let accountId: string;
    try {
      accountId = resolveTargetAccountId(rawAccountId);
    } catch (err) {
      return jsonResponse(
        { error: { code: "no_account", message: err instanceof Error ? err.message : String(err) } },
        400,
        req,
        config,
      );
    }

    let tokenSnapshot;
    try {
      tokenSnapshot = await getValidAccessSnapshotForAccount("xai", accountId, { requireUsableAccount: true });
    } catch (err) {
      return jsonResponse(
        { error: { code: "auth_failed", message: "Failed to resolve valid xAI credentials for account" } },
        401,
        req,
        config,
      );
    }

    // Journaling and Idempotency settlement check
    const effectiveOpId = operationId ?? crypto.randomUUID();
    const opRecord = openGrokResetCouponOperation({
      accountId,
      tokenId: requestedTokenId,
      operationId: effectiveOpId,
    });

    let resolvedTokenId = requestedTokenId;
    let resolvedTokenValidityEnd: number | undefined;
    let resumingAttempt = false;

    if (opRecord.kind === "replay") {
      if (opRecord.code !== undefined) {
        return jsonResponse(
          {
            code: opRecord.code,
            replayed: true,
            tokenId: opRecord.tokenId,
            settledAt: opRecord.settledAt,
          },
          200,
          req,
          config,
        );
      }
      // "attempted" with no recorded outcome: the spend call fired (or the
      // process died right after the mark) but nothing was settled. Never
      // replay this as a success — reconcile against upstream instead. A
      // token missing from the remaining list was consumed; a token still
      // listed means the redeem never landed and the op can safely resume.
      if (requestedTokenId !== undefined && requestedTokenId !== opRecord.tokenId) {
        // The retry names a different coupon than the one marked: spending
        // either of them would surprise the caller — refuse and let them
        // retry with the recorded token or a fresh operationId.
        return jsonResponse(
          {
            error: {
              code: "operation_token_mismatch",
              message: "Operation was attempted with a different coupon; retry with the same tokenId or a new operationId",
            },
          },
          409,
          req,
          config,
        );
      }
      if (opRecord.tokenId === undefined) {
        // An attempted record always stores its token — an absent one means
        // the ledger was hand-edited; refuse rather than guess at a spend.
        return jsonResponse(
          {
            error: {
              code: "attempt_unresolved",
              message: "Attempted operation has no recorded token; retry with a new operationId",
            },
          },
          409,
          req,
          config,
        );
      }
      if (
        opRecord.attemptedAt === undefined ||
        Date.now() - opRecord.attemptedAt < GROK_COUPON_ATTEMPT_STALE_MS
      ) {
        // A fresh attempt may still be in flight in the original request —
        // resuming it here would send a second spend upstream. Only an
        // attempt older than the stale window is provably stranded.
        return jsonResponse(
          {
            error: {
              code: "attempt_in_progress",
              message: "A redemption attempt for this operation is recent and may still be running; retry later",
            },
          },
          409,
          req,
          config,
        );
      }
      let remainingTokens: GrokResetCoupon[];
      try {
        const remaining = await getGrokRemainingResets({ accessToken: tokenSnapshot.accessToken });
        remainingTokens = remaining.tokens;
      } catch (err) {
        return jsonResponse(
          { error: { code: "attempt_reconcile_failed", message: err instanceof Error ? err.message : String(err) } },
          502,
          req,
          config,
        );
      }
      if (!remainingTokens.some((t) => t.tokenId === opRecord.tokenId)) {
        // Absent from the remaining list: either the spend landed or the
        // coupon merely lapsed. Only a recorded validity window still in the
        // future proves consumption; out-of-window and unrecorded cases are
        // undecidable — the spend may have succeeded AND lapsed — so report
        // nothing instead of fabricating an outcome either way.
        const validityEnd = opRecord.tokenValidityEnd;
        if (validityEnd === undefined || validityEnd <= Date.now()) {
          return jsonResponse(
            {
              error: {
                code: "attempt_unresolved",
                message: "Interrupted redemption could not be verified against upstream; check the account's remaining resets",
              },
            },
            409,
            req,
            config,
          );
        }
        try {
          recordGrokResetCouponSettlement({
            operationId: effectiveOpId,
            tokenId: opRecord.tokenId,
            code: "redeemed",
            status: "success",
          });
        } catch {
          // Settle failed again — the op stays "attempted" and the next retry
          // reconciles the same way; the consumed token still bars a re-spend.
        }
        return jsonResponse(
          {
            success: true,
            code: "redeemed",
            replayed: true,
            tokenId: opRecord.tokenId,
            accountId,
            operationId: effectiveOpId,
          },
          200,
          req,
          config,
        );
      }
      resolvedTokenId = opRecord.tokenId;
      resumingAttempt = true;
    }

    if (opRecord.kind === "identity-mismatch") {
      return jsonResponse(
        {
          error: {
            code: "operation_id_owned_by_another_account",
            message: "Operation ID was previously registered with a different account or token",
          },
        },
        409,
        req,
        config,
      );
    }

    if (opRecord.kind !== "execute" && !resumingAttempt) {
      return jsonResponse(
        {
          error: {
            code: opRecord.kind,
            message: "Coupon ledger capacity or unavailable failure",
          },
        },
        503,
        req,
        config,
      );
    }

    if (!resumingAttempt) {
      // Always consult the upstream list: it resolves the token when the
      // caller omits one, and — for an explicit tokenId — proves the coupon
      // still exists while capturing its validity window so an interrupted
      // attempt can later tell "spent" from "expired".
      let tokens: GrokResetCoupon[];
      try {
        const remaining = await getGrokRemainingResets({ accessToken: tokenSnapshot.accessToken });
        tokens = remaining.tokens ?? [];
      } catch (err) {
        return jsonResponse(
          { error: { code: "fetch_resets_failed", message: err instanceof Error ? err.message : String(err) } },
          502,
          req,
          config,
        );
      }
      if (!resolvedTokenId) {
        if (tokens.length === 0) {
          recordGrokResetCouponSettlement({
            operationId: effectiveOpId,
            code: "no_coupons_available",
            status: "failed",
          });
          return jsonResponse(
            { error: { code: "no_coupons_available", message: "No reset coupons available to redeem" } },
            400,
            req,
            config,
          );
        }
        resolvedTokenId = tokens[0].tokenId;
      }
      const match = tokens.find((t) => t.tokenId === resolvedTokenId);
      if (!match) {
        // The requested coupon is already consumed or expired upstream —
        // redeeming it would only surface an upstream error.
        recordGrokResetCouponSettlement({
          operationId: effectiveOpId,
          tokenId: resolvedTokenId,
          code: "coupon_unavailable",
          status: "failed",
        });
        return jsonResponse(
          {
            error: {
              code: "coupon_unavailable",
              message: "The requested reset coupon is no longer available upstream",
            },
          },
          409,
          req,
          config,
        );
      }
      const parsedEnd = Date.parse(match.validityEnd);
      if (!Number.isNaN(parsedEnd)) resolvedTokenValidityEnd = parsedEnd;
    }

    if (resolvedTokenId === undefined) {
      // Unreachable: every path above either resolves a token or returns.
      return jsonResponse(
        { error: { code: "token_unresolved", message: "No reset coupon token could be resolved" } },
        500,
        req,
        config,
      );
    }

    if (grokCouponInFlightAttempts.has(effectiveOpId)) {
      // The original request holding this operation is still running in this
      // process — its upstream spend has not concluded, so nothing may spend
      // on this operationId again regardless of how stale the mark looks.
      return jsonResponse(
        {
          error: {
            code: "attempt_in_progress",
            message: "A redemption attempt for this operation is still running; retry later",
          },
        },
        409,
        req,
        config,
      );
    }

    grokCouponInFlightAttempts.add(effectiveOpId);
    try {
      // Record the attempt BEFORE the spend call: a crash between redemption
      // and settlement must still leave the operation non-open so a retry can
      // never execute it again. A failed mark write aborts here — nothing was
      // spent. A resumed attempt is already marked; the call is a no-op.
      try {
        markGrokResetCouponAttempt(effectiveOpId, resolvedTokenId, undefined, undefined, resolvedTokenValidityEnd);
      } catch (err) {
        return jsonResponse(
          { error: { code: "attempt_mark_failed", message: err instanceof Error ? err.message : String(err) } },
          500,
          req,
          config,
        );
      }

      try {
        await redeemGrokResetCoupon({
          accessToken: tokenSnapshot.accessToken,
          tokenId: resolvedTokenId,
        });
      } catch (err) {
        try {
          recordGrokResetCouponSettlement({
            operationId: effectiveOpId,
            tokenId: resolvedTokenId,
            code: "redeem_failed",
            status: "failed",
          });
        } catch {
          // The operation stays "attempted" — non-open, so a retry still
          // cannot re-execute; the failure is only lost from the record.
        }
        return jsonResponse(
          { error: { code: "redeem_failed", message: err instanceof Error ? err.message : String(err) } },
          502,
          req,
          config,
        );
      }

      // Settlement after a successful redemption is a ledger write, not a
      // redemption step: the coupon IS spent, so any failure to record it
      // must still answer as a redemption — reporting a failure invites a
      // retry the still-open ledger record would honour with a second coupon.
      let settlementRecorded = true;
      try {
        recordGrokResetCouponSettlement({
          operationId: effectiveOpId,
          tokenId: resolvedTokenId,
          code: "redeemed",
          status: "success",
        });
      } catch {
        settlementRecorded = false;
      }

      return jsonResponse(
        {
          success: true,
          code: "redeemed",
          replayed: false,
          tokenId: resolvedTokenId,
          accountId,
          operationId: effectiveOpId,
          settlementRecorded,
        },
        200,
        req,
        config,
      );
    } finally {
      grokCouponInFlightAttempts.delete(effectiveOpId);
    }
  }

  return null;
}
