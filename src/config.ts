import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OcxConfig } from "./types";
import { configReasoningPinsConfigError } from "./config/provider-validation";
import { recordOwnedConfigPath } from "./lib/config-ownership";
import { assertNotRealHomeUnderTest } from "./lib/test-home-guard";
import {
  adoptCustomModelCatalogMigration,
  projectCustomModelCatalogMigration,
} from "./codex/custom-model-catalog-migration";
import { refreshUserCostOverlays } from "./usage/user-cost-overlays";
import {
  clearPendingConfigTopLevelDeletions,
  projectConfigRebaseProvenance,
} from "./config/rebase-provenance";
import { getConfigDir, getConfigPath, hardenConfigDir } from "./config/paths";
export { DEFAULT_SUBAGENT_MODELS } from "./config/subagent-models";
export {
  AtomicWriteResidualTempError,
  AtomicWriteSecretResidualError,
  atomicWriteFile,
  atomicWriteFileAsync,
  renameAtomicFile,
  resolveWriteTarget,
  type AtomicRenameIO,
  type AtomicWriteAsyncIO,
  type AtomicWriteAsyncTestSeam,
  type AtomicWriteIO,
} from "./config/atomic-write";
export { expandUserPath, getConfigDir, getConfigPath, hardenConfigDir } from "./config/paths";
export {
  getPidPath,
  getRuntimePortPath,
  isOcxStartCommandLine,
  ocxStartProcessCacheSizeForTests,
  parsePidFile,
  readAlivePid,
  readPid,
  readPidFileValue,
  readRuntimePort,
  removePid,
  removePidIfValueIs,
  removeRuntimePort,
  removeRuntimePortIfPidIs,
  setOcxStartProcessCacheForTests,
  setOcxStartProcessProbeForTests,
  setProcessCommandLineExecForTests,
  setProcessCommandLinePlatformForTests,
  sweepDeadOcxStartProcessCache,
  verifyPidIdentity,
  writePid,
  writeRuntimePort,
  type RuntimePortState,
} from "./config/process-state";
export { deleteConfigTopLevelKey } from "./config/rebase-provenance";
export { isValidProviderName, hasOwnProvider } from "./config/provider-name";
export {
  apiKeyTransportConfigError,
  booleanRecordConfigError,
  modelAdapterRecordConfigError,
  modelDisplayNamesConfigError,
  autoReviewModelOverridesConfigError,
  autoReviewModelTargetConfigError,
  nonBlankStringArrayConfigError,
  normalizeNonBlankStringArray,
  normalizeAutoReviewModelOverrides,
  positiveIntegerConfigError,
  positiveIntegerRecordConfigError,
  providerBaseUrlConfigError,
  providerHeadersConfigError,
  reasoningSummaryDeliveryRecordConfigError,
  upstreamHttpVersionConfigError,
} from "./config/provider-validation";
export { reconcileConfigWarningMemos } from "./config/warn-memo";
export {
  OpenAiTierBackupCleanupError,
  OpenAiTierBackupRollbackError,
  OpenAiTierBackupCollisionError,
  OpenAiTierRollbackPreserveError,
  OpenAiTierBackupSecretResidualError,
  classifyOpenAiTierBackup,
  backupConfigBeforeOpenAiTierMigration,
  preserveOpenAiTierRollbackSnapshot,
  type OpenAiTierBackupIO,
  type OpenAiTierRollbackPreserveIO,
} from "./config/openai-tier-backup";
export {
  websocketsEnabled,
  ultraFastTierEnabled,
  CATALOG_AUTO_REFRESH_DEFAULT_INTERVAL_MS,
  CATALOG_AUTO_REFRESH_MIN_INTERVAL_MS,
  isCatalogAutoRefreshEnabled,
  resolveCatalogAutoRefreshIntervalMs,
} from "./config/feature-flags";
export {
  codexAutoStartEnabled,
  CODEX_SHIM_AUTO_RESTORE_ENV,
  codexShimAutoRestoreEnabled,
  multiAgentGuidanceEnabled,
  runtimeRole,
  getDefaultConfig,
  resolveEnvValue,
  applyProxyEnv,
  applyProxyEnvWith,
} from "./config/proxy-env";
export {
  requestPacingConfigError,
  providerWebSearchBridgeConfigError,
  providerModelCostsConfigError,
  sanitizeModelCostsForDisplay,
  modelPreferHostedToolsConfigError,
} from "./config/schema/leaf-validators";
export { hardenExistingSecret, retryOn429PolicyConfigError, retryOnResetPolicyConfigError } from "./config/load-degrade";
export { backupInvalidConfig } from "./config/salvage";
export type { ConfigDiagnostics, ConfigAdmissionSnapshot } from "./config/diagnostics";
export {
  subagentDefaultSyncEffective,
  loopbackCompanionBindError,
  validateConfigCandidate,
  readConfigDiagnostics,
  observeInitialConfigState,
  readConfigAdmissionSnapshot,
} from "./config/diagnostics";
export {
  ConfigMutationLockError,
  NestedConfigMutationError,
  prepareConfigMutationDatabasePathForWrite,
  withConfigMutationLockSync,
  readConfigGeneration,
  observeConfigGeneration,
  readConfigGenerationInCurrentMutationTransaction,
  bumpConfigGeneration,
  withExpectedConfigGenerationSync,
} from "./config/mutation-lock";
export {
  armClaudeCodeBaseline,
  adoptPersistedProviderIntoLiveConfig,
  claudeCodeBaselineArmed,
  reconcileLiveConfigFromDisk,
  saveConfigPreservingClaudeCode,
} from "./config/live-reconcile";

// create-only path — never persist-unlocked / atomicWriteFile
import { InitialConfigPublicationError, publishInitialConfigNoReplace, type InitialConfigPublicationIO } from "./config/initialize";
import { observeInitialConfigState } from "./config/diagnostics";
import {
  configDiagnosticsFromRaw,
  mergeConfigDefaults,
  readConfigFileSnapshot,
  validateConfigCandidate,
  type ConfigFileSnapshot,
} from "./config/diagnostics";

// replace path — never publishInitialConfigNoReplace
import { persistConfigUnlocked, readRawConfigJson } from "./config/persist-unlocked";

import { withConfigMutationLockSync, bumpGenerationForCooperatingConfigWrite } from "./config/mutation-lock";
import { getDefaultConfig } from "./config/proxy-env";
import { configSchema } from "./config/schema/config-schema";
import {
  hardenExistingSecret,
  normalizeApiKeyIds,
  normalizeClaudeSubagentEffort,
  normalizeNativeSubagentSync,
  sanitizeAliasesForLoad,
  sanitizeReasoningPinsForLoad,
  sanitizeModelDisplayNamesForLoad,
  sanitizeAutoReviewForLoad,
  sanitizeRetryOn429ForLoad,
  sanitizeModelCostsForLoad,
  sanitizeCapabilityDeclarationsForLoad,
  warnInheritedFastWireConflicts,
  warnDegradedTopLevelOptIns,
  warnDegradedHostname,
  warnDegradedListeners,
  warnDegradedApiKeys,
  warnDegradedCodexAccountPriorities,
  warnDegradedCodexQuotaAutoRefresh,
  warnDegradedClaudeSubagentEffort,
  warnDegradedNativeSubagentConfig,
  warnDegradedCodexAccountPicker,
  warnDegradedUpstreamHostCircuitThreshold,
  warnDegradedPlaintextV2AgentMessages,
  warnDegradedAgentTaskRecovery,
  warnDegradedRuntimeRole,
  warnDegradedOptionalRemoteBlocks,
  warnDegradedQuotaResetNotify,
  warnDegradedCatalogAutoRefresh,
  warnDegradedCodexPool,
  warnDegradedCredentialGroups,
  withRefreshedCostOverlays,
} from "./config/load-degrade";
import {
  salvageConfigCandidate,
  warnConfigRepaired,
  warnDroppedConfigSections,
  warnAndBackupInvalidConfig,
} from "./config/salvage";

/**
 * Load and validate config.json into an OcxConfig. Missing files reset to
 * defaults and clear stale overlays. Broken existing files also fall back to
 * default routing (after backup), but keep the last-good cost-overlay registry
 * until a valid config or a genuinely missing file is observed. A partially-
 * invalid config is merged with defaults so providers and pool accounts survive.
 */
export function loadConfig(): OcxConfig {
  const dir = getConfigDir();
  const configPath = getConfigPath();
  hardenConfigDir();
  hardenExistingSecret(configPath);
  hardenExistingSecret(join(dir, "auth.json"));
  if (!existsSync(configPath)) {
    return withRefreshedCostOverlays(getDefaultConfig());
  }
  try {
    const raw = readFileSync(configPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    sanitizeAliasesForLoad(parsed);
    sanitizeReasoningPinsForLoad(parsed);
    sanitizeModelDisplayNamesForLoad(parsed);
    sanitizeAutoReviewForLoad(parsed);
    sanitizeRetryOn429ForLoad(parsed);
    sanitizeModelCostsForLoad(parsed);
    sanitizeCapabilityDeclarationsForLoad(parsed);
    const result = configSchema.safeParse(parsed);
    if (result.success) {
      const config = normalizeApiKeyIds(result.data as OcxConfig);
      warnInheritedFastWireConflicts(configPath, config);
      warnDegradedTopLevelOptIns(parsed, config);
      warnDegradedHostname(parsed, config);
      warnDegradedListeners(parsed, config);
      warnDegradedApiKeys(parsed, config);
      warnDegradedCodexAccountPriorities(parsed, config);
      warnDegradedCodexQuotaAutoRefresh(parsed, config);
      warnDegradedClaudeSubagentEffort(parsed);
      warnDegradedNativeSubagentConfig(parsed, config);
      warnDegradedCodexAccountPicker(parsed);
      warnDegradedUpstreamHostCircuitThreshold(parsed);
      warnDegradedPlaintextV2AgentMessages(parsed);
      warnDegradedAgentTaskRecovery(parsed);
      warnDegradedRuntimeRole(parsed);
      warnDegradedOptionalRemoteBlocks(parsed);
      warnDegradedQuotaResetNotify(parsed);
      warnDegradedCatalogAutoRefresh(parsed);
      warnDegradedCodexPool(parsed);
      warnDegradedCredentialGroups(parsed);
      return withRefreshedCostOverlays(normalizeClaudeSubagentEffort(normalizeNativeSubagentSync(config, parsed), parsed));
    }
    // Schema validation failed — merge defaults into the raw object instead of
    // discarding it entirely, so pool accounts and providers survive a missing
    // field like defaultProvider.
    const merged = mergeConfigDefaults(parsed);
    const retryResult = configSchema.safeParse(merged);
    if (retryResult.success) {
      warnConfigRepaired(configPath, result.error);
      const config = normalizeApiKeyIds(retryResult.data as OcxConfig);
      warnInheritedFastWireConflicts(configPath, config);
      warnDegradedHostname(parsed, config);
      warnDegradedListeners(parsed, config);
      warnDegradedApiKeys(parsed, config);
      warnDegradedCodexAccountPriorities(parsed, config);
      warnDegradedCodexQuotaAutoRefresh(parsed, config);
      warnDegradedClaudeSubagentEffort(parsed);
      warnDegradedNativeSubagentConfig(parsed, config);
      warnDegradedCodexAccountPicker(parsed);
      warnDegradedUpstreamHostCircuitThreshold(parsed);
      warnDegradedPlaintextV2AgentMessages(parsed);
      warnDegradedAgentTaskRecovery(parsed);
      warnDegradedRuntimeRole(parsed);
      warnDegradedOptionalRemoteBlocks(parsed);
      warnDegradedQuotaResetNotify(parsed);
      warnDegradedCatalogAutoRefresh(parsed);
      warnDegradedCodexPool(parsed);
      warnDegradedCredentialGroups(parsed);
      return withRefreshedCostOverlays(normalizeClaudeSubagentEffort(normalizeNativeSubagentSync(config, parsed), parsed));
    }
    // Still failing, but if every complaint is about one or more named entries
    // in an independent section, drop exactly those and keep the rest. Falling
    // back to defaults here would silently retire the operator's providers,
    // keys and prices over a mistake in one routing profile.
    const salvaged = salvageConfigCandidate(merged, retryResult.error);
    if (salvaged) {
      {
        warnDroppedConfigSections(configPath, salvaged.dropped, salvaged.issues);
        const config = normalizeApiKeyIds(salvaged.parsed);
        warnInheritedFastWireConflicts(configPath, config);
        warnDegradedHostname(parsed, config);
        warnDegradedListeners(parsed, config);
        warnDegradedApiKeys(parsed, config);
        warnDegradedCodexAccountPriorities(parsed, config);
        warnDegradedCodexQuotaAutoRefresh(parsed, config);
        warnDegradedClaudeSubagentEffort(parsed);
        warnDegradedNativeSubagentConfig(parsed, config);
        warnDegradedCodexAccountPicker(parsed);
        warnDegradedUpstreamHostCircuitThreshold(parsed);
        warnDegradedPlaintextV2AgentMessages(parsed);
        warnDegradedAgentTaskRecovery(parsed);
        warnDegradedRuntimeRole(parsed);
        warnDegradedOptionalRemoteBlocks(parsed);
        warnDegradedQuotaResetNotify(parsed);
        warnDegradedCatalogAutoRefresh(parsed);
        warnDegradedCodexPool(parsed);
        warnDegradedCredentialGroups(parsed);
        return withRefreshedCostOverlays(normalizeClaudeSubagentEffort(normalizeNativeSubagentSync(config, parsed), parsed));
      }
    }
    // Merge couldn't fix it — truly broken config
    warnAndBackupInvalidConfig(configPath, result.error);
    return getDefaultConfig();
  } catch (error) {
    warnAndBackupInvalidConfig(configPath, error);
    return getDefaultConfig();
  }
}

export type PersistedConfigInitializationOutcome = "created" | "exists" | "invalid";

/** Initialize only a missing config; ordinary explicit updates still use saveConfig. */
export function initializePersistedConfigIfMissing(
  config: OcxConfig,
  io?: Partial<InitialConfigPublicationIO>,
): PersistedConfigInitializationOutcome {
  assertNotRealHomeUnderTest(getConfigDir());
  const before = observeInitialConfigState();
  if (before !== "missing") return before;
  let published = false;
  try {
    const persisted = withConfigMutationLockSync((): OcxConfig | "exists" | "invalid" => {
      const current = observeInitialConfigState();
      if (current !== "missing") return current;
      const projected = projectCustomModelCatalogMigration(undefined, projectConfigRebaseProvenance(config));
      if (!validateConfigCandidate(projected).ok) throw new Error("Initial configuration is invalid.");
      if (!publishInitialConfigNoReplace(getConfigPath(), JSON.stringify(projected, null, 2) + "\n", io)) {
        return observeInitialConfigState() === "exists" ? "exists" : "invalid";
      }
      published = true;
      recordOwnedConfigPath(getConfigDir(), getConfigPath());
      bumpGenerationForCooperatingConfigWrite();
      return projected;
    });
    if (typeof persisted === "string") return persisted;
    adoptCustomModelCatalogMigration(config, persisted);
    if (persisted.configRebaseProvenance === undefined) delete config.configRebaseProvenance;
    else config.configRebaseProvenance = structuredClone(persisted.configRebaseProvenance);
    clearPendingConfigTopLevelDeletions(config);
    refreshUserCostOverlays(persisted);
    return "created";
  } catch (cause) {
    if (published) throw new InitialConfigPublicationError("published", false, false, { cause });
    throw cause;
  }
}

/** Persist `config` to config.json under the config-mutation lock. */
export function saveConfig(config: OcxConfig): void {
  const pinError = configReasoningPinsConfigError(config);
  if (pinError) throw new Error(pinError);
  // Keep the real-home assertion ahead of even lock-directory preparation.
  assertNotRealHomeUnderTest(getConfigDir());
  withConfigMutationLockSync(() => {
    const withProvenance = projectCustomModelCatalogMigration(
      readRawConfigJson(),
      projectConfigRebaseProvenance(config),
    );
    if (persistConfigUnlocked(withProvenance)) bumpGenerationForCooperatingConfigWrite();
    adoptCustomModelCatalogMigration(config, withProvenance);
    if (withProvenance.configRebaseProvenance === undefined) delete config.configRebaseProvenance;
    else config.configRebaseProvenance = structuredClone(withProvenance.configRebaseProvenance);
    clearPendingConfigTopLevelDeletions(config);
  });
}

export type PersistedConfigMutation<T> = {
  changed: boolean;
  value: T;
};

export type PersistedConfigMutationOutcome<T> =
  | { status: "committed" | "unchanged"; value: T }
  | { status: "unavailable"; reason: "missing" | "invalid" | "conflict" };

const CONFIG_MUTATION_MAX_REBASE_ATTEMPTS = 3;
let persistedConfigMutationBeforeCommitForTests: (() => void) | null = null;

/** Test-only one-shot seam: inject a competing mutation after the first decision, before freshness revalidation. */
export function setPersistedConfigMutationBeforeCommitForTests(hook: (() => void) | null): void {
  persistedConfigMutationBeforeCommitForTests = hook;
}

function unavailableConfigMutationReason(snapshot: ConfigFileSnapshot): "missing" | "invalid" {
  return snapshot.diagnostics.source === "default" ? "missing" : "invalid";
}

/**
 * Patch a schema-valid on-disk config under the shared mutation lock. Cooperating writers are
 * serialized; the callback is rerun on the newest snapshot so observed direct byte changes rebase
 * and credential predicates are re-evaluated immediately before the atomic commit. A writer that
 * ignores the coordinator can still change bytes after the final check because the filesystem has
 * no portable conditional rename. Missing or malformed config always fails closed and is never
 * recreated from a prior snapshot.
 */
export function mutatePersistedConfig<T>(
  mutate: (config: OcxConfig) => PersistedConfigMutation<T>,
): PersistedConfigMutationOutcome<T> {
  // Avoid creating/opening the coordinator database for a read-path update that already knows
  // there is no valid config. The same check runs again under the transaction for authority.
  const observed = readConfigFileSnapshot();
  if (observed.diagnostics.source !== "file" || observed.raw === undefined) {
    return { status: "unavailable", reason: unavailableConfigMutationReason(observed) };
  }
  return withConfigMutationLockSync(() => {
    let base = readConfigFileSnapshot();
    for (let attempt = 0; attempt < CONFIG_MUTATION_MAX_REBASE_ATTEMPTS; attempt += 1) {
      if (base.diagnostics.source !== "file" || base.raw === undefined) {
        return { status: "unavailable", reason: unavailableConfigMutationReason(base) };
      }

      const tentativeConfig = structuredClone(base.diagnostics.config);
      const tentative = mutate(tentativeConfig);
      if (!tentative.changed) return { status: "unchanged", value: tentative.value };

      const hook = persistedConfigMutationBeforeCommitForTests;
      persistedConfigMutationBeforeCommitForTests = null;
      hook?.();

      const latest = readConfigFileSnapshot();
      if (latest.diagnostics.source !== "file" || latest.raw === undefined) {
        return { status: "unavailable", reason: unavailableConfigMutationReason(latest) };
      }
      if (latest.raw !== base.raw) {
        base = latest;
        continue;
      }

      // Re-run against a fresh clone even when config bytes are unchanged: a Codex credential
      // generation lives in a separate file and may have changed at the injected seam.
      const confirmedConfig = structuredClone(latest.diagnostics.config);
      const confirmed = mutate(confirmedConfig);
      if (!confirmed.changed) return { status: "unchanged", value: confirmed.value };

      const commitBase = readConfigFileSnapshot();
      if (commitBase.diagnostics.source !== "file" || commitBase.raw === undefined) {
        return { status: "unavailable", reason: unavailableConfigMutationReason(commitBase) };
      }
      if (commitBase.raw !== latest.raw) {
        base = commitBase;
        continue;
      }

      const projected = projectCustomModelCatalogMigration(
        commitBase.diagnostics.config,
        projectConfigRebaseProvenance(confirmedConfig),
      );
      if (persistConfigUnlocked(projected)) bumpGenerationForCooperatingConfigWrite();
      return { status: "committed", value: confirmed.value };
    }
    return { status: "unavailable", reason: "conflict" };
  });
}

export function websocketsEnabled(config: Pick<OcxConfig, "websockets">): boolean {
  return config.websockets === true;
}

// ---------------------------------------------------------------------------
// Hand-edit protection for the `claudeCode` subtree (devlog 260726_claude_auth_auto/040 H1).
//
// `saveConfig` serializes the WHOLE config object, so ANY service-time save — a model
// visibility toggle, a 429 key rotation on the request path — rewrites `claudeCode`
// from whatever the long-lived server config happens to hold. A user who hand-edits
// `config.json` while the proxy runs then watches their edit vanish for no visible
// reason (issue #488). Enumerating `claudeCode` mutators cannot fix that; the guard has
// to live in ONE save wrapper that every live-config writer goes through.
// ---------------------------------------------------------------------------

/**
 * Baseline keyed on the CONFIG INSTANCE, never a module global: a second `loadConfig()`
 * elsewhere must not refresh the baseline the long-lived server config is judged
 * against, or a later stale save would masquerade as "our own change".
 */
const claudeCodeBaseline = new WeakMap<OcxConfig, unknown>();

/**
 * The live config retains the address of the socket Bun actually opened, while
 * this map retains the operator's desired address for the next process start.
 * Keeping them separate prevents an unrelated live save from restoring a stale
 * externally exposed bind after OAuth adopted a newer loopback disk config.
 */
type PersistedServerBinding = Pick<OcxConfig, "port" | "hostname">;

const persistedLiveServerBinding = new WeakMap<OcxConfig, PersistedServerBinding>();

/**
 * Arm the baseline for a long-lived config. MANDATORY at `startServer`, not lazy on
 * first save — arming lazily would lose exactly the hand edit made before that first
 * save, which is the case the guard exists for.
 */
export function armClaudeCodeBaseline(config: OcxConfig): void {
  claudeCodeBaseline.set(config, structuredClone(config.claudeCode));
}

/** Test seam only: is this instance armed? */
export function claudeCodeBaselineArmed(config: OcxConfig): boolean {
  return claudeCodeBaseline.has(config);
}

/**
 * Adopt a field-scoped Claude Code write into a long-lived config snapshot.
 *
 * Scoped writers commit against the current file rather than serializing the
 * whole snapshot. Mirror that committed subtree and rebase the hand-edit guard
 * together so a later unrelated save does not mistake the scoped write for an
 * outstanding in-memory mutation.
 */
export function adoptPersistedClaudeCode(
  config: OcxConfig,
  persistedClaudeCode: OcxConfig["claudeCode"],
): void {
  config.claudeCode = structuredClone(persistedClaudeCode);
  if (claudeCodeBaseline.has(config)) {
    claudeCodeBaseline.set(config, structuredClone(persistedClaudeCode));
  }
}

/**
 * Structural compare of parsed subtrees. NOT `JSON.stringify`: key order must not
 * decide whether a user's hand edit survives.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  // `undefined` values and absent keys are the same thing after a JSON round-trip.
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] === undefined && right[key] === undefined) continue;
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

const MISSING_CONFIG_VALUE = Symbol("missing-config-value");
type ConfigMergeValue = unknown | typeof MISSING_CONFIG_VALUE;

function isPlainConfigRecord(value: ConfigMergeValue): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownConfigValue(record: Record<string, unknown>, key: string): ConfigMergeValue {
  return Object.hasOwn(record, key) ? record[key] : MISSING_CONFIG_VALUE;
}

function cloneConfigValue(value: ConfigMergeValue): ConfigMergeValue {
  return value === MISSING_CONFIG_VALUE ? value : structuredClone(value);
}

function reconcileConfigRecord(
  live: Record<string, unknown>,
  baseline: Record<string, unknown>,
  persisted: Record<string, unknown>,
  skippedKeys?: ReadonlySet<string>,
): void {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(live), ...Object.keys(persisted)]);
  for (const key of keys) {
    if (skippedKeys?.has(key)) continue;
    const merged = reconcileConfigValue(
      ownConfigValue(baseline, key),
      ownConfigValue(live, key),
      ownConfigValue(persisted, key),
    );
    if (merged === MISSING_CONFIG_VALUE) delete live[key];
    else live[key] = merged;
  }
}

function reconcileConfigValue(
  baseline: ConfigMergeValue,
  live: ConfigMergeValue,
  persisted: ConfigMergeValue,
): ConfigMergeValue {
  const liveChanged = !deepEqual(live, baseline);
  const persistedChanged = !deepEqual(persisted, baseline);

  if (!liveChanged) {
    if (live !== MISSING_CONFIG_VALUE && Array.isArray(live) && Array.isArray(persisted)) {
      live.splice(0, live.length, ...structuredClone(persisted));
      return live;
    }
    if (isPlainConfigRecord(live) && isPlainConfigRecord(persisted)) {
      reconcileConfigRecord(
        live,
        isPlainConfigRecord(baseline) ? baseline : {},
        persisted,
      );
      return live;
    }
    return cloneConfigValue(persisted);
  }

  if (!persistedChanged) return live;

  if (isPlainConfigRecord(live)
    && isPlainConfigRecord(persisted)
    && (baseline === MISSING_CONFIG_VALUE || isPlainConfigRecord(baseline))) {
    reconcileConfigRecord(
      live,
      isPlainConfigRecord(baseline) ? baseline : {},
      persisted,
    );
  }
  // Same-leaf conflicts prefer the pending live management mutation.
  return live;
}

/**
 * Reconcile an async OAuth disk commit into the shared live config without erasing
 * management mutations that have not saved yet. The baseline is a normalized disk
 * snapshot from immediately before login; disjoint object edits merge recursively,
 * while same-leaf conflicts prefer live state.
 */
export function reconcileLiveConfigFromDisk(config: OcxConfig, persistedBaseline: OcxConfig): void {
  const diagnostics = readConfigDiagnostics();
  if (diagnostics.source === "fallback") {
    throw new Error(`OAuth config reconciliation failed: ${diagnostics.error ?? "invalid config file"}`);
  }
  const persisted = diagnostics.config;
  const claudeGuardArmed = claudeCodeBaseline.has(config);
  const pendingLiveClaudeMutation = claudeGuardArmed
    && !deepEqual(config.claudeCode, claudeCodeBaseline.get(config));

  persistedLiveServerBinding.set(config, {
    port: persisted.port,
    ...(persisted.hostname !== undefined ? { hostname: persisted.hostname } : {}),
  });

  reconcileConfigRecord(
    config as unknown as Record<string, unknown>,
    persistedBaseline as unknown as Record<string, unknown>,
    persisted as unknown as Record<string, unknown>,
    new Set(["hostname", "port", ...(claudeGuardArmed ? ["claudeCode"] : [])]),
  );

  if (claudeGuardArmed && !pendingLiveClaudeMutation) {
    if (persisted.claudeCode === undefined) delete config.claudeCode;
    else config.claudeCode = structuredClone(persisted.claudeCode);
    claudeCodeBaseline.set(config, structuredClone(config.claudeCode));
  }
}

/** The literal file, with no schema merge or default injection. */
function readRawConfigJson(): Record<string, unknown> | undefined {
  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) return undefined;
    const raw = readFileSync(configPath, "utf-8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    // Unreadable or corrupt: behave exactly as before. Never fail a save over protection.
    return undefined;
  }
}

/**
 * Read only schema-valid binding fields from the literal file. Missing fields mean
 * their schema defaults; malformed fields keep the last known persisted value.
 */
function readPersistedServerBinding(
  raw: Record<string, unknown>,
  baseline: PersistedServerBinding,
): PersistedServerBinding {
  const port = raw.port === undefined
    ? 10100
    : (typeof raw.port === "number"
        && Number.isInteger(raw.port)
        && raw.port >= 0
        && raw.port <= 65535
      ? raw.port
      : baseline.port);
  const hostname = raw.hostname === undefined
    ? undefined
    : (typeof raw.hostname === "string" ? raw.hostname : baseline.hostname);
  return { port, ...(hostname !== undefined ? { hostname } : {}) };
}

/**
 * The save entry point for every writer holding a LIVE server config.
 *
 * Conflict policy, chosen deliberately:
 * - disk changed, we did not → their hand edit wins;
 * - disk changed AND we changed → our change wins and the baseline rebases, so the
 *   user's next edit starts from the new value (a three-way merge is out of scope);
 * - file missing/unreadable → save what we have, no throw.
 *
 * Scope residual: only `claudeCode` is reconciled. A hand edit to `providers` is still
 * clobbered — recorded and asserted in tests so it cannot drift into an assumed
 * guarantee.
 */
export function saveConfigPreservingClaudeCode(config: OcxConfig): void {
  withConfigMutationLockSync(() => {
    const bindingBaseline = persistedLiveServerBinding.get(config);
    const onDisk = claudeCodeBaseline.has(config) || bindingBaseline
      ? readRawConfigJson()
      : undefined;
    if (claudeCodeBaseline.has(config)) {
      if (onDisk !== undefined) {
        const baseline = claudeCodeBaseline.get(config);
        const persistedClaudeCode = normalizePersistedClaudeCode(onDisk.claudeCode);
        const diskChanged = !deepEqual(persistedClaudeCode, baseline);
        const weChanged = !deepEqual(config.claudeCode, baseline);
        if (diskChanged && !weChanged) {
          config.claudeCode = persistedClaudeCode;
        }
      }
    }
    const persistedBinding = bindingBaseline && onDisk
      ? readPersistedServerBinding(onDisk, bindingBaseline)
      : bindingBaseline;
    if (persistedBinding) {
      const persistedConfig: OcxConfig = { ...config, port: persistedBinding.port };
      if (persistedBinding.hostname === undefined) delete persistedConfig.hostname;
      else persistedConfig.hostname = persistedBinding.hostname;
      if (persistConfigUnlocked(persistedConfig)) bumpGenerationForCooperatingConfigWrite();
      persistedLiveServerBinding.set(config, persistedBinding);
    } else {
      if (persistConfigUnlocked(config)) bumpGenerationForCooperatingConfigWrite();
    }
    if (claudeCodeBaseline.has(config)) {
      claudeCodeBaseline.set(config, structuredClone(config.claudeCode));
    }
  });
}

export function codexAutoStartEnabled(config: Pick<OcxConfig, "codexAutoStart">): boolean {
  return config.codexAutoStart !== false;
}

export const CODEX_SHIM_AUTO_RESTORE_ENV = "OPENCODEX_CODEX_SHIM_AUTO_RESTORE";

export function codexShimAutoRestoreEnabled(
  config: Pick<OcxConfig, "codexShimAutoRestore">,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return config.codexShimAutoRestore !== false && env[CODEX_SHIM_AUTO_RESTORE_ENV] !== "0";
}

export function multiAgentGuidanceEnabled(
  config: Pick<OcxConfig, "multiAgentGuidanceEnabled">,
): boolean {
  return config.multiAgentGuidanceEnabled !== false;
}

export function getDefaultConfig(): OcxConfig {
  // Fresh-install default: works out of the box with Codex's ChatGPT OAuth (no API key).
  // gpt-* requests forward the caller's incoming OAuth headers to the ChatGPT backend.
  // Adding extra providers (e.g. opencode-go) and switching defaultProvider is a user/runtime choice.
  return {
    port: 10100,
    managementUsageMaxReadBytes: 64 * 1024 * 1024,
    appOwnedMemoryBudgetMb: DEFAULT_APP_OWNED_MEMORY_BUDGET_BYTES / (1024 * 1024),
    // Fresh/re-initialized configs are already written in the current three-tier
    // OpenAI shape. Mark them as such so startup does not mistake them for a
    // legacy config and collide with an immutable backup from an earlier setup.
    openaiProviderTierVersion: OPENAI_PROVIDER_TIER_VERSION,
    providers: {
      openai: {
        adapter: "openai-responses",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        authMode: "forward",
        codexAccountMode: "pool",
      },
    },
    defaultProvider: "openai",
    subagentModels: [...DEFAULT_SUBAGENT_MODELS],
    multiAgentGuidanceEnabled: true,
    websockets: false,
    codexAutoStart: true,
    codexShimAutoRestore: true,
  };
}

export function resolveEnvValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^\$\{(\w+)\}$/);
  if (match) return process.env[match[1]];
  if (value.startsWith("$")) return process.env[value.slice(1)];
  return value;
}

/**
 * Mirror `config.proxy` into HTTP(S)_PROXY env vars so Bun's native fetch routes every outbound
 * provider call through the proxy — no per-callsite changes (verified: Bun honors these plus
 * NO_PROXY). User-set env vars always win; localhost/127.0.0.1 are appended to NO_PROXY so the
 * CLI's own health checks and running-proxy API calls stay direct. Call once per process entry
 * that makes outbound provider requests (server start, catalog sync).
 */
export function applyProxyEnv(config: OcxConfig): void {
  const proxy = resolveEnvValue(config.proxy);
  if (!proxy) return;
  if (!process.env.HTTP_PROXY?.trim() && !process.env.http_proxy?.trim()) process.env.HTTP_PROXY = proxy;
  if (!process.env.HTTPS_PROXY?.trim() && !process.env.https_proxy?.trim()) process.env.HTTPS_PROXY = proxy;
  const existing = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  const entries = existing.split(",").map(s => s.trim()).filter(Boolean);
  const seen = new Set(entries.map(e => e.toLowerCase()));
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    if (!seen.has(host)) {
      entries.push(host);
      seen.add(host);
    }
  }
  process.env.NO_PROXY = entries.join(",");
}

export function writePid(pid: number): void {
  const dir = getConfigDir();
  // Guard before ANY directory mutation (mkdir or chmod), not just the write.
  assertNotRealHomeUnderTest(dir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    hardenConfigDir();
  }
  atomicWriteFile(getPidPath(), String(pid));
}

export type RuntimePortState = {
  pid: number;
  port: number;
  hostname?: string;
  /** Per-process proof key; protected by the config directory and never served. */
  attestationSecret?: string;
};

function isValidRuntimePortState(value: unknown): value is RuntimePortState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  const hostnameOk = state.hostname === undefined || typeof state.hostname === "string";
  const attestationOk = state.attestationSecret === undefined || isLocalAttestationSecret(state.attestationSecret);
  return Number.isSafeInteger(state.pid)
    && Number(state.pid) > 0
    && Number.isInteger(state.port)
    && Number(state.port) > 0
    && Number(state.port) <= 65535
    && hostnameOk
    && attestationOk;
}

export function writeRuntimePort(state: RuntimePortState): void {
  const dir = getConfigDir();
  // Guard before ANY directory mutation (mkdir or chmod), not just the write.
  assertNotRealHomeUnderTest(dir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    hardenConfigDir();
  }
  atomicWriteFile(getRuntimePortPath(), JSON.stringify(state, null, 2) + "\n");
}

export function readPid(): number | null {
  const pidPath = getPidPath();
  if (!existsSync(pidPath)) return null;
  try {
    const raw = readFileSync(pidPath, "utf-8").trim();
    const pid = parsePidFile(raw);
    if (pid === null) return null;
    try {
      process.kill(pid, 0);
      return isLikelyOcxStartProcess(pid) ? pid : null;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "EPERM") {
        return isLikelyOcxStartProcess(pid) ? pid : null;
      }
      return null;
    }
  } catch {
    return null;
  }
}

export function readRuntimePort(expectedPid?: number): RuntimePortState | null {
  try {
    const parsed = JSON.parse(readFileSync(getRuntimePortPath(), "utf-8"));
    if (!isValidRuntimePortState(parsed)) return null;
    if (expectedPid !== undefined && parsed.pid !== expectedPid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function removePid(expectedPid?: number): void {
  if (expectedPid !== undefined && readPidFileValue() !== expectedPid) return;
  try {
    unlinkSync(getPidPath());
  } catch { /* ignore */ }
}

function warnConfigRepaired(configPath: string, error: z.ZodError): void {
  if (warnedConfigFallbacks.has(configPath)) return;
  warnedConfigFallbacks.add(configPath);
  const fields = error.issues.map(i => i.path.join(".") || "config").join(", ");
  console.error(`opencodex config at ${configPath}: repaired missing field(s) [${fields}] with defaults. Your providers and accounts are preserved.`);
}

export function readPidFileValue(): number | null {
  try {
    return parsePidFile(readFileSync(getPidPath(), "utf-8"));
  } catch {
    return null;
  }
}

export function removeRuntimePort(expectedPid?: number): void {
  if (expectedPid !== undefined && readRuntimePort(expectedPid) === null) return;
  try {
    unlinkSync(getRuntimePortPath());
  } catch { /* ignore */ }
}

/**
 * Snapshot-guarded stale-state purge: remove the pid/runtime files only when their content
 * still matches what the caller saw BEFORE its liveness probe. A concurrent `ocx start` can
 * write fresh records mid-probe; an unconditional purge would erase the new proxy's state.
 */
export function removePidIfValueIs(snapshot: number | null): void {
  if (!existsSync(getPidPath())) return;
  if (readPidFileValue() !== snapshot) return;
  try {
    unlinkSync(getPidPath());
  } catch { /* ignore */ }
}

export function removeRuntimePortIfPidIs(snapshotPid: number | null): void {
  const current = readRuntimePort();
  if ((current?.pid ?? null) !== snapshotPid) return;
  try {
    unlinkSync(getRuntimePortPath());
  } catch { /* ignore */ }
}

export function parsePidFile(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const pid = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function isOcxStartCommandLine(commandLine: string): boolean {
  const normalized = commandLine.toLowerCase().replace(/\\/g, "/");
  // "src/cli.ts" matches pre-restructure installs still running; "src/cli/index.ts" is current.
  // `@bitkyc08/.opencodex-*` is npm's in-place rename of the global package during
  // `npm install -g` — a Windows service wrapper can respawn from that temp tree
  // mid-update, and must still count as ocx for port reclaim.
  const hasOcxEntrypoint = normalized.includes("src/cli.ts")
    || normalized.includes("src/cli/index.ts")
    || normalized.includes("@bitkyc08/opencodex")
    || /@bitkyc08\/\.opencodex-/.test(normalized)
    || /(?:^|[\s/"'])(?:ocx|opencodex)(?:\.cmd)?(?:$|[\s"'])/.test(normalized);
  return hasOcxEntrypoint && /(?:^|[\s"'])start(?:$|[\s"'])/.test(normalized);
}

/** Per-process memo: waitForProxy/findLiveProxy used to spawn powershell on every 150ms poll. */
const ocxStartProcessCache = new Map<number, boolean>();
let ocxStartProcessSweepCursor = 0;
let ocxStartProcessProbe: (pid: number) => void = pid => { process.kill(pid, 0); };

export function setOcxStartProcessProbeForTests(probe: ((pid: number) => void) | null): void {
  ocxStartProcessProbe = probe ?? (pid => { process.kill(pid, 0); });
}

export function setOcxStartProcessCacheForTests(entries: Iterable<readonly [number, boolean]>): void {
  ocxStartProcessCache.clear();
  for (const [pid, value] of entries) ocxStartProcessCache.set(pid, value);
  ocxStartProcessSweepCursor = 0;
}

export function sweepDeadOcxStartProcessCache(maxProbes = 64): number {
  const pids: number[] = [];
  let removed = 0;
  for (const pid of ocxStartProcessCache.keys()) {
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
    else if (ocxStartProcessCache.delete(pid)) removed += 1;
  }
  if (pids.length === 0 || maxProbes <= 0) {
    ocxStartProcessSweepCursor = 0;
    return removed;
  }
  const probeCount = Math.min(Math.floor(maxProbes), pids.length);
  const start = ocxStartProcessSweepCursor % pids.length;
  for (let offset = 0; offset < probeCount; offset += 1) {
    const pid = pids[(start + offset) % pids.length]!;
    try {
      ocxStartProcessProbe(pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
      if (ocxStartProcessCache.delete(pid)) removed += 1;
    }
  }
  ocxStartProcessSweepCursor = (start + probeCount) % pids.length;
  return removed;
}

export function ocxStartProcessCacheSizeForTests(): number {
  return ocxStartProcessCache.size;
}

function isLikelyOcxStartProcess(pid: number): boolean {
  const cached = ocxStartProcessCache.get(pid);
  if (cached !== undefined) return cached;
  const commandLine = readProcessCommandLine(pid);
  if (commandLine === undefined) return false;
  const ok = isOcxStartCommandLine(commandLine);
  ocxStartProcessCache.set(pid, ok);
  return ok;
}

/**
 * Alive pid from the pid file without the expensive Windows command-line probe.
 * Safe for liveness polls: callers still identity-check /healthz before trusting the proxy.
 * Destructive stop/kill paths should keep using {@link readPid}, which verifies the cmdline.
 */
export function readAlivePid(): number | null {
  const pid = readPidFileValue();
  if (pid === null) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "EPERM") return pid;
    return null;
  }
}

/**
 * Full identity check of a KNOWN candidate pid (alive + ocx-start command line).
 * Companion to {@link readAlivePid}: liveness discovery may be cheap, but any pid
 * handed to a destructive caller must pass this check — and must equal the candidate
 * it was asked about, so a pidfile rewrite between discovery and verification can
 * never swap in a different process (TOCTOU guard).
 */
export function verifyPidIdentity(candidatePid: number): number | null {
  try {
    process.kill(candidatePid, 0);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "EPERM") return null;
  }
  return isLikelyOcxStartProcess(candidatePid) ? candidatePid : null;
}

function readProcessCommandLine(pid: number): string | undefined {
  try {
    if (process.platform === "win32") {
      // Prefer WMIC over PowerShell: much faster cold start, and windowsHide avoids console flash.
      // Fall back to PowerShell when WMIC is absent (newer Windows images).
      const wmic = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\wbem\\WMIC.exe`;
      try {
        const output = execFileSync(wmic, [
          "process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/VALUE",
        ], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000, windowsHide: true });
        const match = /^CommandLine=(.*)$/m.exec(output.replace(/\r/g, ""));
        const value = match?.[1]?.trim();
        if (value) return value;
      } catch {
        /* WMIC missing or failed — fall through */
      }
      const output = execFileSync("powershell.exe", [
        "-NoProfile",
        "-NoLogo",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000, windowsHide: true });
      return output.trim() || undefined;
    }
    const output = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      windowsHide: true,
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

function warnAndBackupInvalidConfig(configPath: string, error: unknown): void {
  if (warnedConfigFallbacks.has(configPath)) return;
  warnedConfigFallbacks.add(configPath);

  const backupPath = backupInvalidConfig(configPath);
  const reason = error instanceof z.ZodError
    ? error.issues.map(issue => `${issue.path.join(".") || "config"}: ${issue.message}`).join("; ")
    : error instanceof Error ? error.message : String(error);
  const backupNote = backupPath ? ` A backup was written to ${backupPath}.` : "";
  console.error(`Could not load opencodex config at ${configPath}: ${reason}. Using default config.${backupNote}`);
}

export function backupInvalidConfig(configPath: string): string | null {
  if (!existsSync(configPath)) return null;
  const backupPath = `${configPath}.invalid-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    copyFileSync(configPath, backupPath);
    try { chmodSync(backupPath, 0o600); } catch { /* best-effort */ }
    return backupPath;
  } catch {
    return null;
  }
}
