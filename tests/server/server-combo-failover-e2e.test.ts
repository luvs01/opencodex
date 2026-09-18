import { removeTreeWithRetry } from "../helpers/remove-tree";
import { heldResponse } from "../helpers/held-response";
import {
  clearResponseStateForTests,
  flushResponseState,
  responseStatePersistPendingForTests,
} from "../../src/responses/state";
      expect(observed[0]!.log.routeDecision).toBe(parentTrace);
      expect(observed[0]!.log.attempts).toBe(parentAttempts);
    } finally {
      held.release();
    }
  });

  test("connect cancellation wins with 499, no backup, warning, or cooldown", async () => {
    let bHits = 0;
    const a = heldResponse(serve);
    const b = serve(() => { bHits += 1; return chatSuccess("must not run"); });
    const config = comboConfig({
      a: provider("openai-chat", baseUrl(a.server), "key-a"),
      b: provider("openai-chat", baseUrl(b), "key-b"),
    });
    const abort = new AbortController();
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const pending = postLogged(config, {}, { abortSignal: abort.signal });
      await within(a.started, 10_000);
      abort.abort(new DOMException("client closed", "AbortError"));
      const response = await within(pending, 10_000);
      expect(response.status).toBe(499);
      expect(await response.json()).toMatchObject({ error: { code: "client_cancelled" } });
      await expectCancelledAttemptReceipt(config, { provider: "a", model: "m1", adapter: "openai-chat" });
      expect(bHits).toBe(0);
      expect(warnings.some(row => String(row[0]).includes("[combo]"))).toBe(false);
      expect(isComboTargetInCooldown("free", { provider: "a", model: "m1" })).toBe(false);
    } finally {
      abort.abort();
      a.release();
      console.warn = originalWarn;
    }
  });

  test("failure-body cancellation wins before cooldown or backup", async () => {
    const bodyRead = deferred();
    const bodyCancelled = deferred();
    let cancelled = 0;
    let bHits = 0;
