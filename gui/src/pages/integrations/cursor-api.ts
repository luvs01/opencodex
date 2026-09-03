/**
 * Wire type for the read-only Cursor status the server projects at
 * GET /api/native-integrations/cursor (src/server/management/cursor-integration-routes.ts).
 */
import { readJsonIfOk } from "../../fetch-json";

export interface CursorModelExpectation {
  id: string;
  reasoning: string[] | null;
  context: { defaultWindow: number; longWindow: number } | null;
}

export interface CursorIntegrationStatus {
  privateInference: { installed: boolean; path: string | null; version: string | null };
  regularCursor: { installed: boolean; path: string | null };
  gateway: { baseUrl: string; apiKeyMode: "credential" | "placeholder"; placeholder: string };
  models: CursorModelExpectation[];
  guideUrl: string;
}

/** A failed read is null, never "not installed": the overview paints null as unknown. */
export async function loadCursorIntegrationStatus(apiBase: string, signal?: AbortSignal): Promise<CursorIntegrationStatus | null> {
  try {
    const response = await fetch(`${apiBase}/api/native-integrations/cursor`, { signal });
    if (!response.ok) return null;
    const body = await readJsonIfOk<CursorIntegrationStatus>(response);
    if (!body || typeof body !== "object" || !body.gateway || !body.privateInference) return null;
    return body;
  } catch {
    return null;
  }
}
