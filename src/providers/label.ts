import { CODEX_ACCOUNT_LOG_LABEL_RE } from "../codex/account-label";

function canonicalUsageProviderLabel(provider: string): string {
  return provider === "chatgpt" || provider === "openai-multi" ? "openai" : provider;
}

const LEGACY_MAIN_ACCOUNT_PROVIDER_LABELS = new Set(["chatgpt-main", "openai-multi-main"]);

export function baseProviderLabel(provider: string): string {
  const canonical = canonicalUsageProviderLabel(provider);
  if (canonical !== provider) return canonical;
  const cut = provider.lastIndexOf("-");
  if (cut <= 0) return canonicalUsageProviderLabel(provider);
  const suffix = provider.slice(cut + 1);
  // `-main` was the legacy log label for the main Codex account (MAIN_CODEX_ACCOUNT_ID). Restrict
  // that compatibility mapping to the known Codex provider labels so configured providers whose
  // names naturally end in `-main` remain distinct.
  // ChatGPT auth-pool and OpenAI passthrough are the same Codex/OpenAI usage surface, so display
  // summaries normalize them to one `openai` row after recognized main/pool suffixes are removed.
  if (LEGACY_MAIN_ACCOUNT_PROVIDER_LABELS.has(provider)) {
    return canonicalUsageProviderLabel(provider.slice(0, cut));
  }
  return CODEX_ACCOUNT_LOG_LABEL_RE.test(suffix) ? canonicalUsageProviderLabel(provider.slice(0, cut)) : provider;
}
