import { describe, expect, test } from "bun:test";
import { prepareAdapterExchange } from "../../src/server/responses/adapter-dispatch";
import { createResponsesSendBudget } from "../../src/server/responses/request-send-budget";
import { createTranslatorBudget } from "../../src/lib/translator-budget";
import {
  bindTurnTerminationScope,
  hasRecordedTrailingDeliveredFinalAnswer,
  rememberDeliveredFinalAnswer,
} from "../../src/responses/turn-termination";
import type { ProviderAdapter } from "../../src/adapters/base";
import type { OcxMessage, OcxParsedRequest, OcxProviderConfig } from "../../src/types";

// The termination scope resolves its serving credential lazily, so a credential switch between
// binding and the localTerminal check leaves the bound selection stale. The dispatch pipeline must
// revalidate and refresh the live selection BEFORE evaluating the terminal — otherwise a record
// made by the stale credential suppresses work the send path would have moved to the new one.
describe("adapter dispatch local-terminal selection revalidation", () => {
  const ANSWER = "The answer is 42.";
  const STALE_SCOPE = "a".repeat(32);
  const FRESH_SCOPE = "b".repeat(32);
  const BUILD_SENTINEL = "reached-build-request";

  const staleProvider = { authMode: "key", apiKey: "kiro-key-a", baseUrl: "https://example.test" } as unknown as OcxProviderConfig;
  const freshProvider = { authMode: "key", apiKey: "kiro-key-b", baseUrl: "https://example.test" } as unknown as OcxProviderConfig;

  const messages = [
    { role: "user", content: [{ type: "text", text: "question" }] },
    { role: "assistant", content: [{ type: "text", text: ANSWER }] },
  ] as OcxMessage[];

  const recordResponse = {
    output: [{
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text: ANSWER }],
    }],
  };

  const makeParsed = (): OcxParsedRequest =>
    ({ stream: false, modelId: "gpt-5.6-sol" } as unknown as OcxParsedRequest);

  const seedRecord = (scope: string): void => {
    const seeded = makeParsed();
    bindTurnTerminationScope(seeded, scope);
    rememberDeliveredFinalAnswer(seeded, recordResponse);
  };

  const makeAdapter = (): ProviderAdapter => ({
    name: "kiro",
    localTerminal: parsed => hasRecordedTrailingDeliveredFinalAnswer(parsed, messages)
      ? { reason: "kiro_final_answer_already_delivered" }
      : undefined,
    buildRequest: () => { throw new Error(BUILD_SENTINEL); },
    async* parseStream() { /* unreachable on this path */ },
  });

  const makeExchange = (args: {
    parsed: OcxParsedRequest;
    route: { providerName: string; modelId: string; provider: OcxProviderConfig };
    current: boolean;
    // What the real refresh does besides rebuild: move the route onto the live selection.
    onRefresh?: () => void;
  }) => {
    const calls = { refresh: 0 };
    const adapter = makeAdapter();
    const transportState = {
      adapter,
      activeAdapter: adapter,
      sameTargetRequest: undefined,
      sameTargetParsed: undefined,
      sameTargetToken: 0,
      transportToken: 0,
      oauthDispatch: () => undefined,
      imageTierBias: 0,
      isOAuth401ReplayProvider: false,
      sentOAuthSnapshot: undefined,
      refreshResolvedOAuthSelection: async () => null,
      replayOAuthCredentialSnapshot: undefined,
      invalidateSameTargetRequest: () => {},
      resolveSelectionAdapter: () => adapter,
      anthropicPoolAccountId: null,
      anthropicPoolFailovers: 0,
      anthropicSessionKey: null,
      commitResolvedOAuthSelection: async () => null,
      genericFailoverAccountId: null,
      genericFailovers: 0,
      applyFailoverSnapshot: async () => null,
      noteRoutedAttemptSend: () => {},
      selectionIsCurrent: () => args.current,
      adapterBindings: new WeakMap([[adapter, { kind: "api-key" as const, provider: args.route.provider }]]),
      refreshDispatchAdapter: async () => { calls.refresh++; args.onRefresh?.(); return adapter; },
    };
    const requestContext = {
      options: {},
      config: {},
      logCtx: {},
      req: new Request("http://localhost/v1/responses", { method: "POST" }),
    };
    return {
      calls,
      run: () => prepareAdapterExchange(
        requestContext as never,
        { pendingHostAdmissionLease: null, authCtx: {} } as never,
        {
          parsed: args.parsed,
          toolBridgeMaps: { toolNsMap: new Map(), freeformToolNames: new Set(), toolSearchToolNames: new Set() },
          translatorBudget: createTranslatorBudget(),
          selectedForwardHeaders: new Headers(),
          route: args.route,
          inboundWire: "responses",
          clientRequestedStream: false,
          subagentQuotaFailureModel: "gpt-5.6-sol",
          subagentFallbackAccountId: null,
        } as never,
        transportState as never,
        { cancelResponseCompletion: () => {}, notifyResponseComplete: () => {}, refreshRequestToolAliases: () => {} } as never,
        createResponsesSendBudget(requestContext as never) as never,
      ),
    };
  };

  test("a stale binding refreshes the selection before evaluating the terminal", async () => {
    // The record was made under the STALE credential. After the refresh moves the route to the
    // live key, the same trailing answer is a different serving identity's work and must send.
    seedRecord(STALE_SCOPE);
    const route = { providerName: "kiro-test", modelId: "gpt-5.6-sol", provider: staleProvider };
    const parsed = makeParsed();
    bindTurnTerminationScope(parsed, () => (route.provider === staleProvider ? STALE_SCOPE : FRESH_SCOPE));
    const exchange = makeExchange({ parsed, route, current: false, onRefresh: () => { route.provider = freshProvider; } });

    const response = await exchange.run();
    // The refreshed selection has no record, so the terminal misses and the turn reaches
    // buildRequest — which the pipeline maps to an error response carrying the sentinel.
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(BUILD_SENTINEL);
    expect(exchange.calls.refresh).toBe(1);
  });

  test("a post-refresh terminal still suppresses under the live credential", async () => {
    // Same setup, but the record belongs to the LIVE credential: refreshing first keeps the
    // legitimate suppression instead of evaluating it against the stale selection.
    seedRecord(FRESH_SCOPE);
    const route = { providerName: "kiro-test", modelId: "gpt-5.6-sol", provider: staleProvider };
    const parsed = makeParsed();
    bindTurnTerminationScope(parsed, () => (route.provider === staleProvider ? STALE_SCOPE : FRESH_SCOPE));
    const exchange = makeExchange({ parsed, route, current: false, onRefresh: () => { route.provider = freshProvider; } });

    const response = await exchange.run();
    expect(response.status).toBe(200);
    expect(exchange.calls.refresh).toBe(1);
    const json = await response.json() as { output?: unknown[] };
    expect(json.output ?? []).toHaveLength(0);
  });

  test("a failed refresh skips the terminal check entirely", async () => {
    // The record was made under the stale credential and would still match under it: evaluating
    // the terminal after a failed refresh is what turns the credential error into a fake success.
    seedRecord(STALE_SCOPE);
    const route = { providerName: "kiro-test", modelId: "gpt-5.6-sol", provider: staleProvider };
    const parsed = makeParsed();
    bindTurnTerminationScope(parsed, () => (route.provider === staleProvider ? STALE_SCOPE : FRESH_SCOPE));
    const exchange = makeExchange({
      parsed, route, current: false,
      onRefresh: () => { throw new Error("credential unavailable"); },
    });

    const response = await exchange.run();
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(BUILD_SENTINEL);
    expect(exchange.calls.refresh).toBe(1);
  });

  test("a current binding is not re-resolved before the terminal check", async () => {
    seedRecord(STALE_SCOPE);
    const route = { providerName: "kiro-test", modelId: "gpt-5.6-sol", provider: staleProvider };
    const parsed = makeParsed();
    bindTurnTerminationScope(parsed, () => (route.provider === staleProvider ? STALE_SCOPE : FRESH_SCOPE));
    const exchange = makeExchange({ parsed, route, current: true });

    const response = await exchange.run();
    expect(response.status).toBe(200);
    expect(exchange.calls.refresh).toBe(0);
  });
});
