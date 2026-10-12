import { describe, expect, test } from "bun:test";
import { getActiveTurnCount, tryAdmitTurn } from "../../src/server/lifecycle";

describe("active-turn cancellation ownership", () => {
  test("retains saturated admission until stalled work settles without aborting sibling work", () => {
    const leases = [];
    try {
      for (let index = 0; index < 512; index += 1) {
        const lease = tryAdmitTurn();
        if (!lease) break;
        leases.push(lease);
      }
      expect(leases.length).toBeGreaterThan(1);
      const cancelled = leases[0]!;
      const sibling = leases[1]!;
      const cancellation = new AbortController();
      const work = new AbortController();
      const siblingWork = new AbortController();
      cancelled.bindAbortSignal(cancellation.signal);
      cancelled.bindAbortController(work);
      sibling.bindAbortController(siblingWork);

      cancellation.abort(new Error("client disconnected"));

      expect(work.signal.aborted).toBe(true);
      expect(siblingWork.signal.aborted).toBe(false);
      expect(getActiveTurnCount()).toBe(leases.length);
      expect(tryAdmitTurn()).toBeNull();

      const lateWork = new AbortController();
      cancelled.bindAbortController(lateWork);
      expect(lateWork.signal.aborted).toBe(true);
      const selection = cancelled.beginCodexAccountSelection();
      expect(selection.claimMainProfile()).toBe(false);
      selection.release();
    } finally {
      for (const lease of leases) lease.release();
    }
  });
});
