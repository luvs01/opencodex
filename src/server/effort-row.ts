import { comboModelId, comboPublicModelId } from "../combos/types";
import { detectCursorInstalls } from "../integrations/cursor-detect";
import {
  loadCursorEffortTable,
  type CursorEffortTable,
} from "../integrations/cursor-effort-table";
import {
  canonicalizeReasoningEfforts,
  isDeclaredReasoningEffort,
} from "../reasoning-effort";
import { isFastRowNamespaceAmbiguous } from "../codex/model-cache";
import { knownModelIdsForProvider } from "../router";
import { policyModelId, policyPublicModelId } from "../routing/profile";
import type { OcxConfig } from "../types";
import { routedSlug } from "../providers/slug-codec";
import { predictCursorEffort } from "./models-capabilities";

const EFFORT_ROW_SEPARATOR = "--";
/** Terminal marker of the sibling Fast grammar (`FAST_ROW_SUFFIX` in fast-row.ts, which
 * imports this module — importing back would close a cycle). */
const FAST_ROW_ID_SUFFIX = "--fast";

export interface ParsedEffortRowId {
  baseId: string;
  effort: string;
}

export type EffortRowKnownIds = ReadonlySet<string> | ((id: string) => boolean);

export interface EffortRowOptions {
  knownIds?: EffortRowKnownIds;
  table?: CursorEffortTable | null;
  supportsReasoning?: boolean;
}

export function isKnownId(knownIds: EffortRowKnownIds | undefined, id: string): boolean {
  return typeof knownIds === "function"
    ? knownIds(id)
    : knownIds?.has(id) === true || knownIds?.has(id.toLowerCase()) === true;
}

export function effortRowId(baseId: string, effort: string): string {
  return `${baseId}${EFFORT_ROW_SEPARATOR}${effort}`;
}

/**
 * Exact configured/public ids that must beat the synthetic terminal-suffix grammar.
 * This is request-local because live-model cache contents can change while the server runs.
 */
export function knownEffortRowIds(config: OcxConfig): EffortRowKnownIds {
  const ids = new Set<string>();
  const addAlias = (id: string): void => {
    ids.add(id);
    // Model aliases are resolved case-insensitively. Preserve that contract here so an
    // alias cannot be mistaken for a synthetic effort row before ordinary routing runs.
    ids.add(id.toLowerCase());
  };
  // Providers whose observed `--fast` evidence outgrew its enumeration bound. Their sets
  // can no longer list every real suffixed id, so the namespace itself counts as known:
  // a `--fast` selector spelling that could be one of theirs must never be rewritten to
  // a surviving base on the strength of incomplete evidence.
  const ambiguousFastRows: { prefixes: string[]; bareBases: Set<string> }[] = [];
  for (const [providerName, provider] of Object.entries(config.providers)) {
    const known = knownModelIdsForProvider(providerName, provider, config);
    const namespaces = [providerName, provider.alias].filter((value): value is string => (
      typeof value === "string" && value.length > 0
    ));
    for (const id of known) {
      ids.add(id);
      ids.add(routedSlug(providerName, id));
      for (const namespace of namespaces) ids.add(`${namespace}/${id}`);
    }
    for (const alias of Object.values(provider.modelAliases ?? {})) {
      addAlias(alias);
      for (const namespace of namespaces) addAlias(`${namespace}/${alias}`);
    }
    if (isFastRowNamespaceAmbiguous(providerName)) {
      ambiguousFastRows.push({
        // Lowercased: provider namespaces and aliases resolve case-insensitively
        // downstream, so the ambiguity guard must match every casing of them.
        prefixes: namespaces.map(namespace => `${namespace.toLowerCase()}/`),
        bareBases: new Set(
          [...known, ...Object.values(provider.modelAliases ?? {})].map(id => id.toLowerCase()),
        ),
      });
    }
  }
  for (const [id, combo] of Object.entries(config.combos ?? {})) {
    ids.add(comboModelId(id));
    ids.add(comboPublicModelId(id, combo));
  }
  for (const [id, profile] of Object.entries(config.routingProfiles ?? {})) {
    ids.add(policyModelId(id));
    ids.add(policyPublicModelId(id, profile));
  }
  if (ambiguousFastRows.length === 0) return ids;
  return (id) => {
    if (ids.has(id) || ids.has(id.toLowerCase())) return true;
    if (!id.endsWith(FAST_ROW_ID_SUFFIX)) return false;
    const baseId = id.slice(0, -FAST_ROW_ID_SUFFIX.length).toLowerCase();
    const lowerId = id.toLowerCase();
    for (const { prefixes, bareBases } of ambiguousFastRows) {
      // `provider/…` and `alias/…` spellings — routed-slug encodings included — pin the
      // selector to this provider, so any suffixed id under them may be a real model.
      if (prefixes.some(prefix => lowerId.startsWith(prefix))) return true;
      // A bare `x--fast` may be this provider's unrecorded real id only while `x` is
      // still one of its known bases; otherwise the grammar stays usable for it.
      if (bareBases.has(baseId)) return true;
    }
    return false;
  };
}

/** Resolve the installed Private Inference effort table once for the current request. */
export function loadDetectedCursorEffortTable(): CursorEffortTable | null {
  const privateInference = detectCursorInstalls().find(install => install.build === "private-inference");
  return loadCursorEffortTable(privateInference);
}

export function parseEffortRowId(
  id: string,
  config: Pick<OcxConfig, "cursorEffortRows">,
  options: EffortRowOptions = {},
): ParsedEffortRowId | null {
  if (config.cursorEffortRows !== true || isKnownId(options.knownIds, id)) return null;

  const separator = id.lastIndexOf(EFFORT_ROW_SEPARATOR);
  if (separator <= 0) return null;
  const baseId = id.slice(0, separator);
  const effort = id.slice(separator + EFFORT_ROW_SEPARATOR.length);
  // "none" is never published as a row (discovery filters it), so it is never accepted either.
  if (effort === "none" || !isDeclaredReasoningEffort(effort)) return null;
  if (predictCursorEffort(baseId, options.table ?? null, options.supportsReasoning).ladder !== null) {
    return null;
  }
  return { baseId, effort };
}

/** Parse one ingress selector against the current config and installed Cursor table. */
export function parseRequestEffortRowId(id: string, config: OcxConfig): ParsedEffortRowId | null {
  if (config.cursorEffortRows !== true) return null;
  // Ordinary ids carry no separator; bail before the known-id scan and install detection so
  // the flag costs nothing on the request path for models that are not effort rows.
  if (id.lastIndexOf(EFFORT_ROW_SEPARATOR) <= 0) return null;
  return parseEffortRowId(id, config, {
    knownIds: knownEffortRowIds(config),
    table: loadDetectedCursorEffortTable(),
  });
}

export function expandCursorEffortRow<T extends { id: string }>(
  row: T,
  efforts: readonly string[] | undefined,
  config: Pick<OcxConfig, "cursorEffortRows">,
  options: EffortRowOptions = {},
): T[] {
  if (config.cursorEffortRows !== true) return [row];

  const supported = canonicalizeReasoningEfforts(
    (efforts ?? []).filter(effort => effort !== "none" && isDeclaredReasoningEffort(effort)),
  );
  const supportsReasoning = options.supportsReasoning ?? supported.length > 0;
  if (predictCursorEffort(row.id, options.table ?? null, supportsReasoning).ladder !== null) {
    return [row];
  }
  return [
    row,
    ...supported
      .map(effort => effortRowId(row.id, effort))
      .filter(id => !isKnownId(options.knownIds, id))
      .map(id => ({ ...row, id })),
  ];
}
