import { execFile, spawnSync } from "node:child_process";
import { lstatSync, readlinkSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

/**
 * Launch and restore execute code from a discovered bundle, so the bundle must be
 * OpenAI-signed and pass ownership/permission checks along its filesystem path. Bundle
 * identifier alone (what discovery checks) is plain text in Info.plist that anyone can copy.
 */
export const OPENAI_TEAM_ID = "2DC432GLL2";

const CODESIGN = "/usr/bin/codesign";
const CODESIGN_TIMEOUT_MS = 30_000;

export interface BundleTrustDeps {
  readonly uid: number;
  readonly adminGroupId?: number;
  stat(path: string): { uid: number; gid?: number; mode: number; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean } | null;
  readlink?(path: string): string;
  codesign(args: readonly string[]): { status: number | null; output: string };
}

export interface AsyncBundleTrustDeps extends Omit<BundleTrustDeps, "codesign"> {
  codesign(args: readonly string[]): Promise<{ status: number | null; output: string }>;
}
interface BundleTrustOptions { resolveLinks?: boolean; signal?: AbortSignal }
type FilesystemTrustDeps = Pick<BundleTrustDeps, "uid" | "adminGroupId" | "stat" | "readlink">;

function filesystemTrustDeps(adminGroupId: number | undefined): FilesystemTrustDeps {
  return {
    adminGroupId,
    uid: typeof process.getuid === "function" ? process.getuid() : -1,
    readlink: readlinkSync,
    stat(path) {
      try {
        const s = lstatSync(path);
        return { uid: s.uid, gid: s.gid, mode: s.mode, isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink() };
      } catch { return null; }
    },
  };
}

export function defaultBundleTrustDeps(): BundleTrustDeps {
  const admin = spawnSync("/usr/bin/dscl", [".", "-read", "/Groups/admin", "PrimaryGroupID"], {
    encoding: "utf8", timeout: 5000,
  });
  const adminId = admin.status === 0 ? /^PrimaryGroupID: ([0-9]+)\s*$/.exec(admin.stdout)?.[1] : undefined;
  return {
    ...filesystemTrustDeps(adminId === undefined ? undefined : Number(adminId)),
    codesign(args) {
      const result = spawnSync(CODESIGN, [...args], { encoding: "utf8", timeout: CODESIGN_TIMEOUT_MS });
      return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    },
  };
}

function ownedSafely(deps: FilesystemTrustDeps, path: string, kind: "file" | "directory"): string | null {
  const s = deps.stat(path);
  if (!s) return "is missing";
  if (s.isSymbolicLink) return "is a symbolic link";
  if (kind === "file" ? !s.isFile : !s.isDirectory) return `is not a ${kind}`;
  if (s.uid !== 0 && s.uid !== deps.uid) return "is owned by another user";
  if ((s.mode & 0o022) !== 0) return "is writable by group or others";
  return null;
}

/** Protect the bundle's directory entry all the way to the filesystem root. */
function untrustedAncestorReason(bundleRoot: string, deps: FilesystemTrustDeps): string | null {
  for (let dir = dirname(bundleRoot); ; dir = dirname(dir)) {
    const s = deps.stat(dir);
    if (!s || !s.isDirectory || s.isSymbolicLink) return `${dir} is not a regular ancestor directory`;
    if (s.uid !== 0 && s.uid !== deps.uid) return `${dir} is owned by another user`;
    // A trusted sticky parent protects the already-checked child from replacement.
    // Root-owned admin-group install containers are privileged OS-controlled paths;
    // resolve that group from the local directory service rather than assuming a GID.
    const sticky = (s.mode & 0o1000) !== 0;
    const privileged = s.uid === 0 && (s.mode & 0o002) === 0
      && deps.adminGroupId !== undefined && s.gid === deps.adminGroupId;
    if ((s.mode & 0o022) !== 0 && !sticky && !privileged) return `${dir} is writable by group or others`;
    if (dirname(dir) === dir) return null;
  }
}

/** Resolve only links whose entries and containing directories are safe from other users. */
function ownedCanonicalPath(path: string, kind: "file" | "directory", deps: FilesystemTrustDeps): string | null {
  if (!posix.isAbsolute(path)) return null;
  let directory = "/", links = 0;
  const pending = path.split("/").filter(Boolean);
  if (untrustedAncestorReason("/__entry__", deps)) return null;
  while (pending.length > 0) {
    const part = pending.shift()!;
    if (part === ".") continue;
    if (part === "..") { directory = posix.dirname(directory); continue; }
    const current = posix.join(directory, part), stat = deps.stat(current);
    if (!stat || (stat.uid !== 0 && stat.uid !== deps.uid)) return null;
    if (stat.isSymbolicLink) {
      if (++links > 40 || !deps.readlink) return null;
      let target: string;
      try { target = deps.readlink(current); } catch { return null; }
      if (!target) return null;
      if (posix.isAbsolute(target)) directory = "/";
      pending.unshift(...target.split("/").filter(Boolean));
      continue;
    }
    if (pending.length === 0 && kind === "file") {
      return !ownedSafely(deps, current, "file") ? current : null;
    }
    if (!stat.isDirectory || untrustedAncestorReason(posix.join(current, "__entry__"), deps)) return null;
    directory = current;
  }
  return kind === "directory" ? directory : null;
}

function bundleTrustTargets(bundleRoot: string, binary: string | undefined, deps: FilesystemTrustDeps, options: BundleTrustOptions) {
  const label = binary === undefined ? "app executable" : "app-server binary";
  binary ??= join(bundleRoot, "Contents", "MacOS", "ChatGPT");
  if (options.resolveLinks) {
    const root = ownedCanonicalPath(bundleRoot, "directory", deps);
    const target = ownedCanonicalPath(binary, "file", deps);
    if (!root || !target) return "the bundle or executable link chain is not safely owned";
    bundleRoot = root; binary = target;
  }
  const inside = relative(bundleRoot, binary);
  if (!inside || inside.startsWith("..") || inside.startsWith(sep)) return `the ${label} is outside the bundle`;
  const fileProblem = ownedSafely(deps, binary, "file");
  if (fileProblem) return `the ${label} ${fileProblem}`;
  for (let dir = dirname(binary); ; dir = dirname(dir)) {
    const dirProblem = ownedSafely(deps, dir, "directory");
    if (dirProblem) return `${dir} ${dirProblem}`;
    if (dir === bundleRoot || dirname(dir) === dir) break;
  }
  return untrustedAncestorReason(bundleRoot, deps) ?? [bundleRoot, binary];
}

/**
 * Null when the bundle root and the selected executable may be run by this user.
 * Restore omits the app-server binary and validates the app shell instead, so a missing
 * app-server does not prevent returning to a normal launch. Otherwise returns a short reason.
 * Every directory from the binary up to the bundle root, and the
 * binary itself, must be owned by root or this user and not group/other-writable, and both the
 * bundle and the binary must pass strict code-signature verification under OpenAI's team ID.
 * Ancestors above the bundle are also checked for POSIX directory-entry replacement rights.
 */
export function untrustedChatgptBundleReason(
  bundleRoot: string,
  binary: string | undefined = undefined,
  deps: BundleTrustDeps = defaultBundleTrustDeps(),
  options: BundleTrustOptions = {},
): string | null {
  const targets = bundleTrustTargets(bundleRoot, binary, deps, options);
  if (typeof targets === "string") return targets;
  for (const target of targets) {
    if (deps.codesign(["--verify", "--strict", target]).status !== 0) return `${target} failed code-signature verification`;
    const details = deps.codesign(["-dv", "--verbose=2", target]);
    if (details.status !== 0 || !new RegExp(`^TeamIdentifier=${OPENAI_TEAM_ID}$`, "m").test(details.output)) {
      return `${target} is not signed by OpenAI (team ${OPENAI_TEAM_ID})`;
    }
  }
  return null;
}

function runTrustCommand(file: string, args: readonly string[], timeout: number, signal?: AbortSignal): Promise<{ status: number | null; output: string }> {
  return new Promise(resolve => {
    try {
      execFile(file, [...args], { encoding: "utf8", timeout, signal, killSignal: "SIGKILL", maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
        resolve({ status: error ? typeof error.code === "number" ? error.code : null : 0, output: `${stdout ?? ""}${stderr ?? ""}` });
      });
    } catch { resolve({ status: null, output: "" }); }
  });
}

/** The same filesystem and signature policy, with cancellable, bounded nonblocking commands. */
export async function untrustedChatgptBundleReasonAsync(
  bundleRoot: string, binary?: string, deps?: AsyncBundleTrustDeps, options: BundleTrustOptions = {},
): Promise<string | null> {
  if (options.signal?.aborted) return "bundle verification aborted";
  if (!deps) {
    const admin = await runTrustCommand("/usr/bin/dscl", [".", "-read", "/Groups/admin", "PrimaryGroupID"], 5000, options.signal);
    const adminId = admin.status === 0 ? /^PrimaryGroupID: ([0-9]+)\s*$/.exec(admin.output)?.[1] : undefined;
    deps = { ...filesystemTrustDeps(adminId === undefined ? undefined : Number(adminId)),
      codesign: args => runTrustCommand(CODESIGN, args, CODESIGN_TIMEOUT_MS, options.signal) };
  }
  const targets = bundleTrustTargets(bundleRoot, binary, deps, options);
  if (typeof targets === "string") return targets;
  for (const target of targets) {
    if (options.signal?.aborted) return "bundle verification aborted";
    if ((await deps.codesign(["--verify", "--strict", target])).status !== 0) return `${target} failed code-signature verification`;
    if (options.signal?.aborted) return "bundle verification aborted";
    const details = await deps.codesign(["-dv", "--verbose=2", target]);
    if (details.status !== 0 || !new RegExp(`^TeamIdentifier=${OPENAI_TEAM_ID}$`, "m").test(details.output)) {
      return `${target} is not signed by OpenAI (team ${OPENAI_TEAM_ID})`;
    }
  }
  return options.signal?.aborted ? "bundle verification aborted" : null;
}
