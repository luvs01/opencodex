import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, unlinkSync, writeFileSync, type BigIntStats } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/paths";
import { assertNotRealHomeUnderTest } from "./test-home-guard";
import { forgetEphemeralSecretPath, hardenSecretDir, hardenSecretPath } from "./windows-secret-acl";

export const GUI_PAIR_INTENT_HEADER = "x-opencodex-gui-pair-intent";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function owned(stat: BigIntStats): boolean {
  return process.platform === "win32" || (stat.uid === BigInt(process.getuid!()) && (stat.mode & 0o022n) === 0n);
}
function same(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.ctimeNs === b.ctimeNs;
}
function directory(path: string): BigIntStats {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat)) throw new Error("Unsafe GUI pairing intent directory");
  return stat;
}
function location(capability: string, configDir: string): { dir: string; path: string } {
  if (!TOKEN.test(capability)) throw new Error("Invalid GUI pairing capability");
  const dir = join(configDir, "gui-pair-intents");
  return { dir, path: join(dir, digest(`opencodex-gui-pair-intent-v1\n${capability}`)) };
}
function removeOwned(path: string, identity: BigIntStats): void {
  try {
    if (same(identity, lstatSync(path, { bigint: true }))) unlinkSync(path);
  } catch { /* expired or already consumed; never remove a replacement */ }
  forgetEphemeralSecretPath(path);
}

export interface GuiPairIntent {
  proof: string;
  dispose(): void;
}

/**
 * Prove write access to the private configuration home, separately from runtime-state reads.
 * Only a SHA-256 commitment goes to disk; the random verifier remains in the requesting CLI.
 * This is an owner-write boundary, NOT proof of human presence or protection from a fully
 * privileged same-user process. The existing HMAC binds PID, port, origin, nonce and expiry.
 */
export function createGuiPairIntent(capability: string, configDir = getConfigDir()): GuiPairIntent {
  assertNotRealHomeUnderTest(configDir);
  directory(configDir);
  const { dir, path } = location(capability, configDir);
  try { mkdirSync(dir, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  directory(dir);
  if (!hardenSecretDir(dir, { required: true, deadlineMs: 2_000 }).ok) throw new Error("GUI pairing intent ACL refused");
  const parent = directory(dir);
  const proof = randomBytes(32).toString("base64url");
  const fd = openSync(path, "wx", 0o600);
  let identity = fstatSync(fd, { bigint: true });
  try {
    writeFileSync(fd, `${digest(proof)}\n`, "utf8");
    if (!hardenSecretPath(path, { required: true, deadlineMs: 2_000 }).ok) throw new Error("GUI pairing intent ACL refused");
    identity = fstatSync(fd, { bigint: true });
    if (!same(identity, lstatSync(path, { bigint: true })) || !owned(identity)
      || identity.nlink !== 1n || parent.dev !== directory(dir).dev || parent.ino !== directory(dir).ino) {
      throw new Error("GUI pairing intent changed during publication");
    }
  } catch (error) {
    identity = fstatSync(fd, { bigint: true });
    closeSync(fd);
    removeOwned(path, identity);
    throw error;
  }
  closeSync(fd);
  return { proof, dispose: () => removeOwned(path, identity) };
}

/** Called only after the existing process-bound, expiring capability passed authorization. */
export function consumeGuiPairIntent(capability: string | null, proof: string | null, configDir = getConfigDir()): boolean {
  if (!capability || !proof || !TOKEN.test(capability) || !TOKEN.test(proof)) return false;
  let fd: number | undefined;
  try {
    assertNotRealHomeUnderTest(configDir);
    directory(configDir);
    const { dir, path } = location(capability, configDir);
    const parent = directory(dir);
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || !owned(before) || before.nlink !== 1n || before.size !== 65n) return false;
    // Do not block on a substituted FIFO. Windows retains descriptor/path identity checks.
    const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
    fd = openSync(path, flags);
    const opened = fstatSync(fd, { bigint: true });
    if (!same(before, opened) || !opened.isFile()) return false;
    const bytes = Buffer.alloc(66);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    if (size !== 65 || !timingSafeEqual(bytes.subarray(0, size), Buffer.from(`${digest(proof)}\n`))) return false;
    const after = fstatSync(fd, { bigint: true });
    if (!same(opened, after) || !same(after, lstatSync(path, { bigint: true }))
      || parent.dev !== directory(dir).dev || parent.ino !== directory(dir).ino) return false;
    closeSync(fd); fd = undefined;
    // Synchronous consume before granting: a second process loses the unlink race and refuses.
    if (!same(after, lstatSync(path, { bigint: true }))) return false;
    unlinkSync(path);
    forgetEphemeralSecretPath(path);
    return true;
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}
