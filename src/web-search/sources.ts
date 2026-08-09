export interface SafeWebSearchSource {
  url: string;
  title?: string;
}

export const MAX_WEB_SEARCH_SOURCES = 20;
export const MAX_WEB_SEARCH_URL_BYTES = 2_048;
export const MAX_WEB_SEARCH_TITLE_BYTES = 256;
export const MAX_WEB_SEARCH_SOURCE_BYTES = 16_384;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Add a client-safe citation while enforcing the per-message count and byte budgets. */
export function appendSafeWebSearchSource(target: SafeWebSearchSource[], source: unknown): boolean {
  if (target.length >= MAX_WEB_SEARCH_SOURCES || !source || typeof source !== "object") return false;
  const candidate = source as { url?: unknown; title?: unknown };
  if (typeof candidate.url !== "string"
    || candidate.url.length === 0
    || CONTROL_CHARACTERS.test(candidate.url)
    || byteLength(candidate.url) > MAX_WEB_SEARCH_URL_BYTES
    || target.some(existing => existing.url === candidate.url)) return false;

  let parsed: URL;
  try { parsed = new URL(candidate.url); } catch { return false; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  let title: string | undefined;
  if (candidate.title !== undefined) {
    if (typeof candidate.title !== "string"
      || candidate.title.length === 0
      || CONTROL_CHARACTERS.test(candidate.title)
      || byteLength(candidate.title) > MAX_WEB_SEARCH_TITLE_BYTES) return false;
    title = candidate.title;
  }

  const next = title ? { url: candidate.url, title } : { url: candidate.url };
  const usedBytes = target.reduce((sum, item) => sum + byteLength(item.url) + byteLength(item.title ?? ""), 0);
  if (usedBytes + byteLength(next.url) + byteLength(next.title ?? "") > MAX_WEB_SEARCH_SOURCE_BYTES) return false;
  target.push(next);
  return true;
}

export function safeWebSearchSources(sources: readonly unknown[]): SafeWebSearchSource[] {
  const safe: SafeWebSearchSource[] = [];
  for (const source of sources) appendSafeWebSearchSource(safe, source);
  return safe;
}
