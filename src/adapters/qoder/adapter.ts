import type { AdapterEvent, OcxParsedRequest, OcxProviderConfig } from "../../types";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterRequest, ProviderAdapter } from "../base";
import { mapReasoningEffort } from "../../reasoning-effort";
import { buildSystemPrompt } from "../coding-agent/protocol";
import { baseScopedEnv, runCodingAgentTurn, type CodingAgentDeps } from "../coding-agent/turn";
import { QODER_PROFILES, type QoderProfile } from "./profiles";

export type QoderAdapterDeps = CodingAgentDeps;

export function buildQoderChildEnv(profile: QoderProfile, apiKey: string): Record<string, string> {
  return { ...baseScopedEnv(), NO_COLOR: "1", [profile.tokenEnv]: apiKey };
}

/** Single-shot, tools-disabled Qoder CLI invocation; Codex remains the tool owner. */
export function buildQoderArgs(parsed: OcxParsedRequest, provider: OcxProviderConfig, systemPromptFile?: string): string[] {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--max-turns", "1",
    "--no-session-persistence",
    "--model", parsed.modelId,
  ];
  const effort = mapReasoningEffort(provider, parsed.modelId, parsed.options.reasoning);
  if (effort) args.push("--reasoning-effort", effort);
  if (systemPromptFile) args.push("--append-system-prompt-file", systemPromptFile);
  return args;
}

export function createQoderAdapter(provider: OcxProviderConfig, deps: QoderAdapterDeps = {}): ProviderAdapter {
  return {
    name: "qoder",
    buildRequest(): AdapterRequest {
      return { url: provider.baseUrl, method: "POST", headers: {}, body: "" };
    },
    async *parseStream(): AsyncGenerator<AdapterEvent> {
      yield { type: "error", message: "Qoder adapter uses runTurn; the fetch/parseStream path is disabled." };
    },
    async runTurn(parsed, incoming, emit): Promise<void> {
      const hasImage = parsed.context.messages.some(message =>
        Array.isArray(message.content) && message.content.some(part => part.type === "image"),
      );
      if (hasImage) {
        emit({
          type: "error",
          message: "Qoder image input is not enabled because the CLI provider route has no verified multimodal contract.",
          status: 400,
          errorType: "invalid_request_error",
          code: "unsupported_input_modality",
          retryable: false,
        });
        return;
      }
      const system = buildSystemPrompt(parsed);
      let promptDir: string | undefined;
      let promptFile: string | undefined;
      try {
        promptDir = system ? await mkdtemp(join(tmpdir(), "ocx-qoder-prompt-")) : undefined;
        promptFile = promptDir ? join(promptDir, "system-prompt.txt") : undefined;
        if (promptFile) await writeFile(promptFile, system!, { encoding: "utf8", mode: 0o600 });
      } catch {
        if (promptDir) await rm(promptDir, { recursive: true, force: true }).catch(() => {});
        emit({
          type: "error",
          message: "Qoder system prompt could not be prepared securely.",
          status: 500,
          errorType: "upstream_error",
          code: "prompt_file_failed",
          retryable: false,
        });
        return;
      }
      try {
        await runCodingAgentTurn({
          profiles: QODER_PROFILES,
          provider,
          parsed,
          incoming,
          emit,
          buildArgs: (_profile, req, prov) => buildQoderArgs(req, prov, promptFile),
          buildEnv: (profile, apiKey) => buildQoderChildEnv(profile as QoderProfile, apiKey),
          deps,
        });
      } finally {
        if (promptDir) await rm(promptDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  };
}
