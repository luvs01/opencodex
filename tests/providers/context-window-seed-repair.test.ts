import { describe, expect, test } from "bun:test";
import { projectStaleContextWindows, STALE_CONTEXT_WINDOWS } from "../../src/providers/stale-context-window-migration";
import type { OcxConfig } from "../../src/types";

function devinConfig(windows: Record<string, number>, adapter = "devin"): OcxConfig {
  return {
    providers: {
      devin: { adapter, baseUrl: "https://server.codeium.com", modelContextWindows: { ...windows } },
    },
  } as unknown as OcxConfig;
}

function alibabaConfig(provider: "alibaba-token-plan" | "alibaba-token-plan-intl", value: number): OcxConfig {
  return { providers: { [provider]: { adapter: "openai-chat", modelContextWindows: { "qwen3.8-max": value } } } } as OcxConfig;
}

describe("stale context window migration", () => {
  test("repairs a window the config inherited from the wrong registry seed", () => {
    // `enrichProviderFromRegistry` is fill-only, so a config saved while the
    // registry shipped 256k for Grok keeps reporting 256k forever. Correcting
    // the registry fixes new installs only; this is what reaches the old ones.
    const config = devinConfig({ "grok-4-5": 256_000, "claude-sonnet-5": 200_000 });
    const projection = projectStaleContextWindows(config);
    expect(projection.changed).toBe(true);
    expect(projection.config.providers!.devin!.modelContextWindows).toMatchObject({
      "grok-4-5": 500_000,
      "claude-sonnet-5": 1_000_000,
    });
    expect(projection.warnings.join(" ")).toContain("grok-4-5 256000 -> 500000");
  });

  test("leaves a value the user chose alone", () => {
    // The guard is an exact match on the wrong number. Anything else is a
    // deliberate override and outranks this migration.
    const config = devinConfig({ "grok-4-5": 300_000 });
    const projection = projectStaleContextWindows(config);
    expect(projection.changed).toBe(false);
    expect(projection.config.providers!.devin!.modelContextWindows!["grok-4-5"]).toBe(300_000);
  });

  test.each(["alibaba-token-plan", "alibaba-token-plan-intl"] as const)(
    "repairs the old qwen3.8-max seed for %s",
    provider => {
      const projection = projectStaleContextWindows(alibabaConfig(provider, 983_616));
      expect(projection.changed).toBe(true);
      expect(projection.config.providers![provider]!.modelContextWindows!["qwen3.8-max"]).toBe(1_000_000);
    },
  );

  test.each(["alibaba-token-plan", "alibaba-token-plan-intl"] as const)(
    "skips %s when the row was repointed to a custom gateway",
    provider => {
      // A repointed row keeps the provider id and the generic openai-chat
      // adapter, so the adapter alone cannot tell Alibaba from another
      // OpenAI-compatible destination — the 983,616 there may be that
      // gateway's real limit rather than the stale registry seed.
      const config = alibabaConfig(provider, 983_616);
      config.providers![provider]!.baseUrl = "https://gateway.example/v1";
      const projection = projectStaleContextWindows(config);
      expect(projection.changed).toBe(false);
      expect(projection.config.providers![provider]!.modelContextWindows!["qwen3.8-max"]).toBe(983_616);
    },
  );

  test("repairs a row pointing at the registry endpoint with a trailing slash", () => {
    const config = alibabaConfig("alibaba-token-plan", 983_616);
    config.providers!["alibaba-token-plan"]!.baseUrl =
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/";
    const projection = projectStaleContextWindows(config);
    expect(projection.changed).toBe(true);
    expect(projection.config.providers!["alibaba-token-plan"]!.modelContextWindows!["qwen3.8-max"]).toBe(1_000_000);
  });

  test.each([
    " HTTPS://TOKEN-PLAN.CN-BEIJING.MAAS.ALIYUNCS.COM/compatible-mode/v1",
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1//",
  ])("repairs a row whose saved endpoint is URL-equivalent to the registry's: %s", baseUrl => {
    // baseUrl is trimmed at parse time and URL schemes/hosts are case-insensitive,
    // so these rows point at the registry destination as surely as the bare URL.
    const config = alibabaConfig("alibaba-token-plan", 983_616);
    config.providers!["alibaba-token-plan"]!.baseUrl = baseUrl;
    const projection = projectStaleContextWindows(config);
    expect(projection.changed).toBe(true);
    expect(projection.config.providers!["alibaba-token-plan"]!.modelContextWindows!["qwen3.8-max"]).toBe(1_000_000);
  });

  test("repairs an intl row pointed at a declared baseUrlChoices endpoint", () => {
    const config = alibabaConfig("alibaba-token-plan-intl", 983_616);
    config.providers!["alibaba-token-plan-intl"]!.baseUrl =
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    const projection = projectStaleContextWindows(config);
    expect(projection.changed).toBe(true);
    expect(projection.config.providers!["alibaba-token-plan-intl"]!.modelContextWindows!["qwen3.8-max"]).toBe(1_000_000);
  });

  test("skips a row that no longer carries the registry adapter", () => {
    // A `devin` row retargeted at another transport is not the provider these
    // numbers describe, so rewriting its windows would be a guess.
    const projection = projectStaleContextWindows(devinConfig({ "grok-4-5": 256_000 }, "openai-chat"));
    expect(projection.changed).toBe(false);
  });

  test("is a no-op on a config with no such provider", () => {
    const projection = projectStaleContextWindows({ providers: {} } as unknown as OcxConfig);
    expect(projection.changed).toBe(false);
    expect(projection.warnings).toEqual([]);
  });

  test("every entry names a real correction", () => {
    // A from/to pair that is equal would make the migration claim a change it
    // never performs, and an entry for another provider would silently do nothing.
    for (const entry of STALE_CONTEXT_WINDOWS) {
      expect(entry.from).not.toBe(entry.to);
      expect(["alibaba-token-plan", "alibaba-token-plan-intl", "devin"]).toContain(entry.provider);
    }
  });
});
