import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeDesktopConfigLibraryDir, resolveConfigLibraryDir } from "./desktop-3p-paths";

export interface Desktop3pConfigLibraryOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

/**
 * Resolve the config library from the same user-data root Claude Desktop uses. Keeping this in one
 * helper prevents the writer and dashboard status probe from agreeing on a path Desktop never reads.
 *
 * The resolution itself lives in `./desktop-3p-paths`, which ports Claude Desktop's own `GE()`
 * branch for branch — including the `-3p` suffix the app appends to its userData root. Dropping
 * that suffix points us at a directory Desktop never reads (GitHub #539).
 */
export function resolveDesktop3pConfigLibraryPath(
  options: Desktop3pConfigLibraryOptions = {},
): string {
  if (options.env === undefined && options.platform === undefined && options.homeDir === undefined) {
    return claudeDesktopConfigLibraryDir();
  }
  return resolveConfigLibraryDir({
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    home: options.homeDir ?? homedir(),
  });
}

export interface Desktop3pMetadataEntry {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface Desktop3pMetadata {
  appliedId?: string;
  entries: Desktop3pMetadataEntry[];
  [key: string]: unknown;
}

export const DESKTOP_PICKER_ENTRY_NAME = "opencodex-picker";

/** Read regular config files only; a path swap must not turn an observation into a FIFO wait. */
export function readDesktopLibraryBytes(path: string): Buffer {
  const expected = lstatSync(path, { bigint: true });
  if (!expected.isFile()) throw new Error("desktop_config_not_regular");
  // POSIX open of a FIFO can itself block, before fstat is possible. Windows has no POSIX
  // FIFO entry; retain descriptor identity validation there without unsupported open flags.
  const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NONBLOCK | constants.O_NOFOLLOW);
  let fd: number;
  try {
    fd = openSync(path, flags);
  } catch (error) {
    // A symlink swapped in after lstat fails the no-follow open with ELOOP; surface the refusal name.
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new Error("desktop_config_not_regular");
    throw error;
  }
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino
      || opened.ctimeNs !== expected.ctimeNs) throw new Error("desktop_config_not_regular");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Text decoding stays identical to node:fs readFileSync(path, "utf8"). */
export function readDesktopLibraryText(path: string): string {
  return readDesktopLibraryBytes(path).toString("utf8");
}

export function parseMetadata(path: string): Desktop3pMetadata {
  if (!existsSync(path)) return { entries: [] };
  const parsed = JSON.parse(readDesktopLibraryText(path)) as Partial<Desktop3pMetadata>;
  if (!Array.isArray(parsed.entries)) throw new Error("Claude Desktop 3P _meta.json has no entries array");
  return { ...parsed, entries: parsed.entries };
}

export const SAFE_DESKTOP_PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOwnedDesktopEntry(entry: Desktop3pMetadataEntry | undefined): boolean {
  return entry?.name === "opencodex" || entry?.name === "opencodex-standard" || entry?.name === DESKTOP_PICKER_ENTRY_NAME;
}

/** A gateway row is removable; the selected standard row must always remain. */
export function isOwnedDesktopGatewayEntry(entry: Desktop3pMetadataEntry | undefined): boolean {
  return entry?.name === "opencodex";
}

export function profilePath(libraryPath: string, id: string): string {
  if (!SAFE_DESKTOP_PROFILE_ID.test(id)) throw new Error("desktop_profile_id_unsafe");
  return join(libraryPath, `${id}.json`);
}

export const OPENCODEX_DESKTOP_PROFILE_KEYS = new Set([
  "inferenceProvider",
  "inferenceCredentialKind",
  "inferenceGatewayBaseUrl",
  "inferenceGatewayApiKey",
  "modelDiscoveryEnabled",
  "inferenceModels",
]);

export function readDesktopProfileForeignKeys(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readDesktopLibraryText(path)) as unknown;
  if (!isRecord(parsed)) throw new Error("Claude Desktop 3P profile is not a JSON object");
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !OPENCODEX_DESKTOP_PROFILE_KEYS.has(key)),
  );
}
