/**
 * Repair context windows that a saved config inherited from a wrong registry seed.
 *
 * `enrichProviderFromRegistry` is fill-only: it seeds `modelContextWindows` when
 * the row has none and never rewrites it afterwards. That posture is right — a
 * hand-tuned window must survive an upgrade — but it means a registry table that
 * shipped WRONG numbers is frozen into every config that was saved while those
 * numbers were current. Correcting the registry alone fixes new installs and
 * leaves existing ones reporting the old figure forever.
 *
 * This rewrites one thing: a window whose saved value is still byte-for-byte the
 * wrong number this file names, on a provider that still carries the registry's
 * adapter and still points at the registry's own endpoint. A value the user
 * changed does not match `from` and is left alone, and nothing else in the row
 * is touched. Same shape and the same restraint as `model-rename-migration`,
 * for the case where the id was right and the number was not.
 */
import { PROVIDER_REGISTRY, normalizedProviderEndpoint } from "./registry";
import type { OcxConfig, OcxProviderConfig } from "../types";

export interface StaleContextWindow {
  /** Registry provider id whose saved rows may carry the wrong window. */
  provider: string;
  model: string;
  /** The wrong value this migration is allowed to replace, and nothing else. */
  from: number;
  to: number;
}

export interface StaleContextWindowProjection {
  config: OcxConfig;
  changed: boolean;
  warnings: string[];
}

/**
 * Known-bad registry context windows corrected against provider evidence.
 *
 * The Alibaba Token Plan correction comes from gateway boundary probes. The
 * shipped Cognition table had been assembled from each model's ORIGINAL vendor window
 * rather than from what Cognition serves, so the Claude rows claimed 200k against
 * an actual 1M and Grok claimed 256k against 500k. Cognition documents no window
 * anywhere, so the per-account catalog is the only first-party source; these are
 * the degraded-mode figures, and live discovery supersedes them when it runs.
 */
export const STALE_CONTEXT_WINDOWS: readonly StaleContextWindow[] = [
  { provider: "alibaba-token-plan", model: "qwen3.8-max", from: 983_616, to: 1_000_000 },
  { provider: "alibaba-token-plan-intl", model: "qwen3.8-max", from: 983_616, to: 1_000_000 },
  { provider: "devin", model: "swe-1-7", from: 256_000, to: 262_000 },
  { provider: "devin", model: "swe-1-7-lightning", from: 256_000, to: 202_752 },
  { provider: "devin", model: "gpt-5-6-sol", from: 1_050_000, to: 1_000_000 },
  { provider: "devin", model: "gpt-5-6-luna", from: 1_050_000, to: 1_000_000 },
  { provider: "devin", model: "gpt-5-6-terra", from: 1_050_000, to: 1_000_000 },
  { provider: "devin", model: "claude-opus-4-8", from: 200_000, to: 1_000_000 },
  { provider: "devin", model: "claude-fable-5-1", from: 200_000, to: 1_000_000 },
  { provider: "devin", model: "claude-sonnet-5", from: 200_000, to: 1_000_000 },
  { provider: "devin", model: "kimi-k2-7", from: 256_000, to: 262_144 },
  { provider: "devin", model: "grok-4-5", from: 256_000, to: 500_000 },
];

/**
 * Only repair a row that still points at the registry's own endpoint. The
 * adapter alone cannot tell the registry provider from another destination —
 * a repointed `alibaba-token-plan-intl` row keeps the generic `openai-chat`
 * adapter, but the windows on its custom gateway are the user's own figures.
 * Same ownership rule as `model-rename-migration`.
 */
function providerStillMatchesRegistry(name: string, prov: OcxProviderConfig): boolean {
  const entry = PROVIDER_REGISTRY.find(row => row.id === name);
  if (!entry || entry.adapter !== prov.adapter) return false;
  if (!prov.baseUrl || !entry.baseUrl) return true;
  const choices = entry.baseUrlChoices?.map(choice => choice.baseUrl) ?? [];
  const known = [entry.baseUrl, ...choices]
    .filter((url): url is string => typeof url === "string")
    .map(normalizedProviderEndpoint);
  return known.includes(normalizedProviderEndpoint(prov.baseUrl));
}

/** Pure projection. The caller decides whether to persist. */
export function projectStaleContextWindows(
  config: OcxConfig,
  entries: readonly StaleContextWindow[] = STALE_CONTEXT_WINDOWS,
): StaleContextWindowProjection {
  const warnings: string[] = [];
  const repaired = new Map<string, string[]>();

  for (const entry of entries) {
    const prov = config.providers?.[entry.provider];
    if (!prov) continue;
    if (!providerStillMatchesRegistry(entry.provider, prov)) continue;
    const windows = prov.modelContextWindows;
    if (!windows || windows[entry.model] !== entry.from) continue;
    windows[entry.model] = entry.to;
    const list = repaired.get(entry.provider) ?? [];
    list.push(`${entry.model} ${entry.from} -> ${entry.to}`);
    repaired.set(entry.provider, list);
  }

  for (const [provider, list] of repaired) {
    warnings.push(
      `corrected ${list.length} context window(s) on "${provider}" that the saved config `
      + `inherited from a wrong registry seed: ${list.join(", ")}.`,
    );
  }

  return { config, changed: repaired.size > 0, warnings };
}
