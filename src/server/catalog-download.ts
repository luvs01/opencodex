/**
 * Shared serialization for the model catalog, used by both the management route
 * (`GET /api/catalog`) and the least-privilege data-plane route
 * (`GET|HEAD /v1/catalog`, issue #809).
 *
 * The point of the shared module is that the two routes must emit the *same
 * bytes*. A remote Codex client previously had to be handed an admin token just
 * to read the catalog, which is the least-privilege violation #809 is about; the
 * fix is a second route on the data plane, never a widened management boundary.
 * If each route serialized independently they would drift, and the data-plane
 * copy is the one nobody looks at in the dashboard.
 */
import { createHash } from "node:crypto";
import { statSync } from "node:fs";

/**
 * Upper bound for the REMOTE route only.
 *
 * The first version of this used 32 MiB and applied it to both routes, which was
 * wrong twice over. The repository supports up to 2,000 discovered models, and a
 * 2,000-row catalog serializes to roughly 92 MB — so 32 MiB rejected a valid
 * supported catalog, and applying it to `/api/catalog` turned a working
 * management response into a 507 for those operators.
 *
 * 256 MiB clears the supported bound with room to spare while still refusing a
 * file that could only be corrupt or hostile. The management route is not
 * subject to it at all: it is a local dashboard read whose behavior predates
 * this module and must not change.
 */
export const MAX_REMOTE_CATALOG_BYTES = 256 * 1024 * 1024;

export interface SerializedCatalog {
  /** Serialized catalog JSON, or null when no catalog could be materialized. */
  body: string | null;
  /** Strong ETag over `body`, present only when `body` is. */
  etag?: string;
  /** Byte length of `body`, present only when `body` is. */
  bytes?: number;
  /** Remote-only preflight failure; management serialization never sets this. */
  error?: "too_large";
}

interface CatalogFileIdentity {
  key: string;
  size: number;
}

let remoteCache: { path: string; identity: string; serialized: SerializedCatalog } | undefined;
let remoteSerialization: { path: string; identity: string; result: Promise<SerializedCatalog> } | undefined;

function catalogFileIdentity(path: string): CatalogFileIdentity | null {
  try {
    const stat = statSync(path, { bigint: true });
    if (!stat.isFile()) return null;
    return {
      key: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`,
      size: Number(stat.size),
    };
  } catch {
    return null;
  }
}

export function catalogEtag(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex")}"`;
}

/**
 * Read and serialize the persisted catalog once.
 *
 * Returns `{ body: null }` for every unreadable case — absent file, unreadable
 * file, malformed JSON — because `readCatalog` already collapses those into
 * `null` and the routes render them identically as a 404. Distinguishing them
 * here would invite one route to leak a filesystem path in an error message.
 *
 * Deliberately does NOT apply a size ceiling: a size policy belongs to the route
 * that serves the bytes, not to the shared serializer both planes depend on.
 */
export async function serializePersistedCatalog(): Promise<SerializedCatalog> {
  const { readCatalog, readCodexCatalogPath } = await import("../codex/catalog");
  const catalog = readCatalog(readCodexCatalogPath());
  if (!catalog) return { body: null };
  const body = JSON.stringify(catalog);
  const bytes = Buffer.byteLength(body, "utf8");
  return { body, etag: catalogEtag(body), bytes };
}

/**
 * Serialize the catalog for the remotely reachable route.
 *
 * File size is checked before the synchronous reader can materialize it. A
 * validated file identity caches the expensive parse/stringify/hash result,
 * and the shared promise limits cache misses to one serialization at a time.
 */
export async function serializeRemotePersistedCatalog(): Promise<SerializedCatalog> {
  const { readCodexCatalogPath } = await import("../codex/catalog");
  const path = readCodexCatalogPath();
  const identity = catalogFileIdentity(path);
  if (!identity) return { body: null };
  if (identity.size > MAX_REMOTE_CATALOG_BYTES) return { body: null, error: "too_large" };
  if (remoteCache?.path === path && remoteCache.identity === identity.key) return remoteCache.serialized;
  if (remoteSerialization) {
    if (remoteSerialization.path === path && remoteSerialization.identity === identity.key) {
      return remoteSerialization.result;
    }
    await remoteSerialization.result;
    return serializeRemotePersistedCatalog();
  }

  const result = (async () => {
    const serialized = await serializePersistedCatalog();
    if (serialized.bytes !== undefined && serialized.bytes > MAX_REMOTE_CATALOG_BYTES) {
      return { body: null, error: "too_large" } as SerializedCatalog;
    }
    const after = catalogFileIdentity(path);
    if (after?.key !== identity.key) return { body: null };
    if (serialized.body !== null) remoteCache = { path, identity: identity.key, serialized };
    return serialized;
  })();
  remoteSerialization = { path, identity: identity.key, result };
  try {
    return await result;
  } finally {
    if (remoteSerialization?.result === result) remoteSerialization = undefined;
  }
}

/**
 * The authoritative Codex version for a catalog response, or undefined.
 *
 * Never fabricated: when no runtime is persisted the header is omitted rather
 * than guessed, so a client cannot mistake "unknown" for a specific version.
 */
export async function persistedCodexVersion(): Promise<string | undefined> {
  const { loadPersistedCodexRuntime } = await import("../codex/runtime");
  return loadPersistedCodexRuntime()?.selectedVersion ?? undefined;
}
