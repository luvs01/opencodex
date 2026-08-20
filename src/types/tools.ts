export interface OcxTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
  /** MCP namespace (e.g. "mcp__context7") for tools flattened out of a Responses "namespace" tool. */
  namespace?: string;
  /** Freeform/custom tool (e.g. apply_patch): the model's call must be relayed as a custom_tool_call. */
  freeform?: boolean;
  /** Client-executed tool discovery (tool_search): the model's call must be relayed as a tool_search_call. */
  toolSearch?: boolean;
  /** Tool definition restored from a prior tool_search output; transports may prioritize it when catalogs are bounded. */
  loadedFromToolSearch?: boolean;
  /** Cursor-only synthetic exact-match edit tool; never inferred from the wire name. */
  cursorStructuredEdit?: true;
  /** Synthetic web_search tool: the model's call is executed by the gpt-5.4-mini sidecar, not relayed to Codex. */
  webSearch?: boolean;
  /** Synthetic image_gen tool: the model's call is executed by the xAI image bridge sidecar, not relayed to Codex. */
  imageGeneration?: boolean;
  /** Synthetic video_gen tool: executed by the xAI video bridge sidecar. */
  videoGeneration?: boolean;
}

/**
 * Wire name a chat model sees for a tool. Namespaced (MCP) tools are flattened to
 * "<namespace>__<name>" so they survive the chat-completions function-tool format;
 * the proxy maps this back to {namespace, name} on the return trip (Codex routes MCP
 * calls by an explicit `namespace` field, not by parsing the name).
 */
export function namespacedToolName(namespace: string | undefined, name: string): string {
  return namespace ? `${namespace}__${name}` : name;
}

export function toolChoiceAliases(tool: Pick<OcxTool, "namespace" | "name">): string[] {
  const wireName = namespacedToolName(tool.namespace, tool.name);
  return tool.namespace ? [wireName, `${tool.namespace}.${tool.name}`] : [wireName];
}

function sameToolIdentity(
  left: Pick<OcxTool, "namespace" | "name">,
  right: Pick<OcxTool, "namespace" | "name">,
): boolean {
  return left.namespace === right.namespace && left.name === right.name;
}

type ToolIdentity = Pick<OcxTool, "namespace" | "name">;

const toolChoiceCandidateIndexes = new WeakMap<
  readonly ToolIdentity[],
  ReadonlyMap<string, readonly ToolIdentity[]>
>();

function toolChoiceCandidateIndex(
  tools: readonly ToolIdentity[],
): ReadonlyMap<string, readonly ToolIdentity[]> {
  const cached = toolChoiceCandidateIndexes.get(tools);
  if (cached) return cached;

  const index = new Map<string, ToolIdentity[]>();
  const identities = new Map<string, Set<string>>();
  for (const tool of tools) {
    const identity = JSON.stringify([tool.namespace ?? null, tool.name]);
    for (const selector of [...toolChoiceAliases(tool), tool.name]) {
      const candidates = index.get(selector);
      if (!candidates) {
        index.set(selector, [tool]);
        identities.set(selector, new Set([identity]));
      } else if (!identities.get(selector)!.has(identity)) {
        candidates.push(tool);
        identities.get(selector)!.add(identity);
      }
    }
  }
  toolChoiceCandidateIndexes.set(tools, index);
  return index;
}

/**
 * All tools that could be selected by one client-facing name. Bare logical names are included
 * here because they are a compatibility selector for namespaced tools, while wire and dotted
 * aliases come from `toolChoiceAliases`. A selector with more than one candidate is invalid.
 */
export function toolChoiceCandidates(
  tools: readonly Pick<OcxTool, "namespace" | "name">[] | undefined,
  name: string,
): Pick<OcxTool, "namespace" | "name">[] {
  if (!tools) return [];
  return [...(toolChoiceCandidateIndex(tools).get(name) ?? [])];
}

/**
 * Newer Codex clients can select a tool nested in a namespace by its bare name. Resolve that
 * shorthand only when the request contains one tool with the logical name, so an ambiguous name
 * cannot authorize a tool from an unintended namespace.
 */
export function toolAllowedByChoice(
  tool: Pick<OcxTool, "namespace" | "name">,
  allowedTools: ReadonlySet<string>,
  tools?: readonly Pick<OcxTool, "namespace" | "name">[],
): boolean {
  if (!tools) return toolChoiceAliases(tool).some(name => allowedTools.has(name));
  for (const name of [...toolChoiceAliases(tool), tool.name]) {
    if (!allowedTools.has(name)) continue;
    const candidates = toolChoiceCandidates(tools, name);
    if (candidates.length === 1 && sameToolIdentity(candidates[0], tool)) return true;
  }
  return false;
}

export function resolveToolChoiceWireName(tools: readonly Pick<OcxTool, "namespace" | "name">[] | undefined, name: string): string {
  const candidates = toolChoiceCandidates(tools, name);
  if (candidates.length === 1) {
    const match = candidates[0];
    return namespacedToolName(match.namespace, match.name);
  }
  // Keep unknown/ambiguous names unchanged for callers that only serialize a selector. The
  // catalog-aware predicate rejects them, and parseRequest rejects ambiguous request selectors.
  return name;
}

/**
 * Whether `modelId` is in a per-provider classification list (e.g. `noVisionModels`). Matches the full
 * id, OR — for Ollama-style ids — the family before the ":size" tag, so a `gpt-oss` entry covers
 * `gpt-oss:120b`/`gpt-oss:20b`. Colon-less ids (e.g. `grok-build-0.1`) still match exactly only.
 */
export function modelInList(list: string[] | undefined, modelId: string): boolean {
  if (!list || list.length === 0) return false;
  if (list.includes(modelId)) return true;
  const colon = modelId.indexOf(":");
  return colon > 0 && list.includes(modelId.slice(0, colon));
}

export type OcxToolChoice =
  | "auto"
  | "none"
  | "required"
  | { name: string }
  | { allowedTools: string[]; mode: "auto" | "required" };

export function isAllowedToolChoice(value: OcxToolChoice | undefined): value is { allowedTools: string[]; mode: "auto" | "required" } {
  return typeof value === "object" && value !== null && "allowedTools" in value;
}

/** Compile the request's tool-choice policy into a reusable advertisement/restoration predicate. */
export function toolChoiceToolPredicate(
  choice: OcxToolChoice | undefined,
  tools?: readonly Pick<OcxTool, "namespace" | "name">[],
): (tool: Pick<OcxTool, "namespace" | "name">) => boolean {
  if (!choice || choice === "auto" || choice === "required") return () => true;
  if (choice === "none") return () => false;
  if (isAllowedToolChoice(choice)) {
    const allowed = new Set(choice.allowedTools);
    return tool => toolAllowedByChoice(tool, allowed, tools);
  }
  if (!tools) return tool => toolChoiceAliases(tool).includes(choice.name);
  const candidates = toolChoiceCandidates(tools, choice.name);
  return tool => candidates.length === 1 && sameToolIdentity(candidates[0], tool);
}
