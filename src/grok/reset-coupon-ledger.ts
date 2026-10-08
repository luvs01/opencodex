import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../config/atomic-write";
import { withConfigMutationLockSync } from "../config/mutation-lock";
import { getConfigDir } from "../config/paths";

export type GrokResetCouponOperationKind = "execute" | "replay" | "identity-mismatch" | "capacity";

export interface GrokResetCouponOperationIdentity {
  accountId: string;
  tokenId?: string;
  operationId: string;
}

export interface GrokResetCouponOperationRecord {
  kind: GrokResetCouponOperationKind;
  operationId: string;
  accountId?: string;
  tokenId?: string;
  /** Token expiry (ms) captured when the attempt was marked, if known — used
   * at reconcile time to tell a consumed coupon from one that merely lapsed. */
  tokenValidityEnd?: number;
  code?: string;
  settledAt?: number;
}

interface GrokResetCouponOperationState {
  accountId: string;
  tokenId?: string;
  // "attempted" sits between open and settled: the spend call already fired,
  // so the operation must never execute again. Its replay carries no code —
  // the route reconciles it against upstream instead of trusting a status.
  status: "open" | "attempted" | "settled" | "failed";
  code?: string;
  tokenValidityEnd?: number;
  createdAt: number;
  updatedAt: number;
}

interface GrokResetCouponLedger {
  version: 1;
  operations: Record<string, GrokResetCouponOperationState>;
}

export function grokCouponJournalPath(customDir?: string): string {
  const dir = customDir ?? getConfigDir();
  return join(dir, "grok-reset-coupon-ledger.json");
}

function readGrokCouponLedger(filePath: string): GrokResetCouponLedger {
  if (!existsSync(filePath)) {
    return { version: 1, operations: {} };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as GrokResetCouponLedger;
    return parsed && parsed.version === 1 && parsed.operations && typeof parsed.operations === "object"
      ? parsed
      : { version: 1, operations: {} };
  } catch {
    return { version: 1, operations: {} };
  }
}

function writeGrokCouponLedger(filePath: string, ledger: GrokResetCouponLedger, now = Date.now()): void {
  // Prune every record past the 30-day window — including "open" and
  // "attempted". An unresolved attempt is only reconcilable while its coupon
  // is still valid (hours, not months), and a ledger that strands records
  // forever would eventually fill the operation cap with dead attempts.
  const retentionCutoff = now - 30 * 24 * 60 * 60_000;
  ledger.operations = Object.fromEntries(
    Object.entries(ledger.operations).filter(([, op]) => op.updatedAt > retentionCutoff),
  );
  atomicWriteFile(filePath, JSON.stringify(ledger, null, 2));
}

const MAX_GROK_RESET_COUPON_OPERATION_IDS = 256;

export function openGrokResetCouponOperation(
  identity: GrokResetCouponOperationIdentity,
  now = Date.now(),
  journalPath?: string,
): GrokResetCouponOperationRecord {
  // Read→decide→write under the shared config mutation lock: two concurrent
  // coupon requests on the same home must not lose an operation record — the
  // ledger exists precisely to make an irreversible spend replay-safe.
  return withConfigMutationLockSync(() => {
  const filePath = journalPath ?? grokCouponJournalPath();
  const ledger = readGrokCouponLedger(filePath);

  // Prune BEFORE the capacity check: expiry is enforced on write, so a ledger
  // full of stale records would otherwise reject every new operation forever
  // (the prune path inside writeGrokCouponLedger is never reached when all
  // openings are rejected).
  const retentionCutoff = now - 30 * 24 * 60 * 60_000;
  ledger.operations = Object.fromEntries(
    Object.entries(ledger.operations).filter(([, op]) => op.updatedAt > retentionCutoff),
  );

  if (Object.keys(ledger.operations).length >= MAX_GROK_RESET_COUPON_OPERATION_IDS) {
    return { kind: "capacity", operationId: identity.operationId };
  }

  const existing = ledger.operations[identity.operationId];
  if (existing) {
    if (existing.accountId !== identity.accountId) {
      return { kind: "identity-mismatch", operationId: identity.operationId };
    }
    if (existing.status !== "open") {
      // Non-open: replay the recorded outcome. "attempted" records carry no
      // code — the caller must reconcile them against upstream, never re-run.
      return {
        kind: "replay",
        operationId: identity.operationId,
        accountId: existing.accountId,
        tokenId: existing.tokenId,
        tokenValidityEnd: existing.tokenValidityEnd,
        code: existing.code,
        settledAt: existing.updatedAt,
      };
    }
    return {
      kind: "execute",
      operationId: identity.operationId,
      accountId: existing.accountId,
      tokenId: existing.tokenId,
    };
  }

  ledger.operations[identity.operationId] = {
    accountId: identity.accountId,
    ...(identity.tokenId === undefined ? {} : { tokenId: identity.tokenId }),
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  writeGrokCouponLedger(filePath, ledger, now);
  return {
    kind: "execute",
    operationId: identity.operationId,
    accountId: identity.accountId,
    tokenId: identity.tokenId,
  };
  });
}

/**
 * Flip an open operation to `attempted` BEFORE the upstream spend call. The
 * write happens while nothing is irreversible yet: if it throws, the caller
 * aborts without spending; if a later settle write dies instead, the
 * operation still refuses blind re-execution — the next open returns a
 * code-less replay the route resolves via the upstream remaining-resets list.
 */
export function markGrokResetCouponAttempt(
  operationId: string,
  tokenId: string,
  now = Date.now(),
  journalPath?: string,
  tokenValidityEnd?: number,
): void {
  withConfigMutationLockSync(() => {
    const filePath = journalPath ?? grokCouponJournalPath();
    const ledger = readGrokCouponLedger(filePath);
    const existing = ledger.operations[operationId];
    if (!existing || existing.status !== "open") return;
    existing.status = "attempted";
    existing.tokenId = tokenId;
    if (tokenValidityEnd !== undefined) existing.tokenValidityEnd = tokenValidityEnd;
    existing.updatedAt = now;
    writeGrokCouponLedger(filePath, ledger, now);
  });
}

export function recordGrokResetCouponSettlement(
  settlement: { operationId: string; tokenId?: string; code: string; status: "success" | "failed" },
  now = Date.now(),
  journalPath?: string,
): void {
  withConfigMutationLockSync(() => {
  const filePath = journalPath ?? grokCouponJournalPath();
  const ledger = readGrokCouponLedger(filePath);
  const existing = ledger.operations[settlement.operationId];
  if (!existing) return;

  existing.status = settlement.status === "success" ? "settled" : "failed";
  existing.code = settlement.code;
  if (settlement.tokenId !== undefined) existing.tokenId = settlement.tokenId;
  existing.updatedAt = now;

  writeGrokCouponLedger(filePath, ledger, now);
  });
}
