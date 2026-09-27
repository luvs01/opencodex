import { createHash, X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withClientLifecycleSync } from "../../client/lifecycle-lock";
import {
  ALL_IP_ADDRESS_BASES,
  createCertificateAuthority,
  issueServerLeaf,
  type LocalInterceptCa,
  type PemKeyPair,
} from "./local-ca";

/** Separate root for Desktop traffic: its critical DNS constraint is checked on every reload. */
export const PICKER_HOST = "claude.ai";
export const PICKER_CA_COMMON_NAME = "opencodex Claude Desktop Picker CA";
export const PICKER_STATE_DIR = "claude-picker";

export interface PickerCa extends LocalInterceptCa { fingerprint: string }

const processAuthorities = new Map<string, PickerCa>();

export function pickerStateDir(configDir: string): string { return join(configDir, PICKER_STATE_DIR); }
export function pickerCaCertPath(configDir: string): string { return join(pickerStateDir(configDir), "ca.pem"); }
export function pickerLeafCertPath(configDir: string): string { return join(pickerStateDir(configDir), "leaf.pem"); }
export function pickerCaOwnerPath(configDir: string): string { return join(pickerStateDir(configDir), "ca-owner.json"); }
function pickerCaLockPath(configDir: string): string { return join(pickerStateDir(configDir), "ca.lock.sqlite"); }

export function pickerCaFingerprints(certPem: string): { sha1: string; sha256: string } {
  const der = new X509Certificate(certPem).raw;
  return {
    sha1: createHash("sha1").update(der).digest("hex").toUpperCase(),
    sha256: createHash("sha256").update(der).digest("hex").toUpperCase(),
  };
}

interface DerItem { tag: number; body: Buffer; next: number }

function readDer(bytes: Buffer, at: number): DerItem | null {
  if (at + 2 > bytes.length) return null;
  const tag = bytes[at]!;
  let length = bytes[at + 1]!;
  let cursor = at + 2;
  if (length & 0x80) {
    const width = length & 0x7f;
    if (width === 0 || width > 4 || cursor + width > bytes.length) return null;
    length = 0;
    for (let i = 0; i < width; i++) length = length * 256 + bytes[cursor++]!;
  }
  if (cursor + length > bytes.length) return null;
  return { tag, body: bytes.subarray(cursor, cursor + length), next: cursor + length };
}

function children(bytes: Buffer): DerItem[] | null {
  const out: DerItem[] = [];
  for (let cursor = 0; cursor < bytes.length;) {
    const item = readDer(bytes, cursor);
    if (!item) return null;
    out.push(item);
    cursor = item.next;
  }
  return out;
}

function constrainedToPickerHost(value: Buffer): boolean {
  const root = readDer(value, 0);
  if (!root || root.tag !== 0x30 || root.next !== value.length) return false;
  const fields = children(root.body);
  if (!fields || fields.length !== 2 || fields[0]!.tag !== 0xa0 || fields[1]!.tag !== 0xa1) return false;
  const excluded = children(fields[1]!.body);
  const excludesAllIps = excluded?.length === ALL_IP_ADDRESS_BASES.length && excluded.every((subtree, index) => {
    const base = subtree.tag === 0x30 ? children(subtree.body) : null;
    return base?.length === 1 && base[0]!.tag === 0x87
      && base[0]!.body.equals(Buffer.from(ALL_IP_ADDRESS_BASES[index]!));
  });
  if (!excludesAllIps) return false;
  const subtrees = children(fields[0]!.body);
  const subtree = subtrees?.length === 1 && subtrees[0]!.tag === 0x30 ? children(subtrees[0]!.body) : null;
  return subtree?.length === 1 && subtree[0]!.tag === 0x82
    && subtree[0]!.body.equals(Buffer.from(PICKER_HOST, "ascii"));
}

interface ParsedExtension { oid: Buffer; critical: boolean; value: Buffer }

/** One Extension SEQUENCE → oid, criticality, and extnValue bytes; malformed shapes return null. */
function parseExtension(item: DerItem): ParsedExtension | null {
  if (item.tag !== 0x30) return null;
  const fields = children(item.body);
  if (!fields || fields.length < 2 || fields.length > 3 || fields[0]!.tag !== 0x06) return null;
  const value = fields[fields.length - 1]!;
  if (value.tag !== 0x04) return null;
  if (fields.length === 2) return { oid: fields[0]!.body, critical: false, value: value.body };
  // DER encodes the critical flag only as BOOLEAN TRUE; anything else is not a real extension.
  if (fields[1]!.tag !== 0x01 || !fields[1]!.body.equals(Buffer.from([0xff]))) return null;
  return { oid: fields[0]!.body, critical: true, value: value.body };
}

// DER OID bodies for the only four extensions a picker authority carries. A SAN, an EKU, or any
// other extension means the certificate is not a picker authority, whatever its subject claims.
const EXT_BASIC_CONSTRAINTS = "551d13";
const EXT_KEY_USAGE = "551d0f";
const EXT_SUBJECT_KEY_IDENTIFIER = "551d0e";
const EXT_NAME_CONSTRAINTS = "551d1e";
const PICKER_CA_EXTENSION_OIDS = new Set([
  EXT_BASIC_CONSTRAINTS, EXT_KEY_USAGE, EXT_SUBJECT_KEY_IDENTIFIER, EXT_NAME_CONSTRAINTS,
]);

/** basicConstraints CA:TRUE with pathLenConstraint 0 — the anchor signs leaves, not other CAs. */
const PICKER_CA_BASIC_CONSTRAINTS = Buffer.from([0x30, 0x06, 0x01, 0x01, 0xff, 0x02, 0x01, 0x00]);
/** keyUsage keyCertSign | cRLSign only — the anchor can never sign a TLS handshake itself. */
const PICKER_CA_KEY_USAGE = Buffer.from([0x03, 0x02, 0x01, 0x06]);

/**
 * The trust decision accepts exactly the extension profile createCertificateAuthority emits, not
 * merely a certificate that happens to contain the right name constraint. A root that also carries
 * leaf privileges (SAN, serverAuth EKU, digitalSignature) could be presented directly as an
 * off-host server certificate, where name constraints on subordinates no longer apply.
 */
function acceptsExtensionProfile(extensions: DerItem[]): boolean {
  const seen = new Set<string>();
  for (const item of extensions) {
    const extension = parseExtension(item);
    if (extension === null) return false;
    const key = extension.oid.toString("hex");
    if (!PICKER_CA_EXTENSION_OIDS.has(key) || seen.has(key)) return false;
    seen.add(key);
    switch (key) {
      case EXT_BASIC_CONSTRAINTS:
        if (!extension.critical || !extension.value.equals(PICKER_CA_BASIC_CONSTRAINTS)) return false;
        break;
      case EXT_KEY_USAGE:
        if (!extension.critical || !extension.value.equals(PICKER_CA_KEY_USAGE)) return false;
        break;
      case EXT_SUBJECT_KEY_IDENTIFIER: {
        const id = readDer(extension.value, 0);
        if (extension.critical || id === null || id.tag !== 0x04 || id.next !== extension.value.length) return false;
        break;
      }
      default:
        if (!extension.critical || !constrainedToPickerHost(extension.value)) return false;
    }
  }
  return seen.size === PICKER_CA_EXTENSION_OIDS.size;
}

/** Independently authorize a root before installing it as system trust. */
export function acceptsPickerAuthority(certPem: string): boolean {
  try {
    const cert = new X509Certificate(certPem);
    const names = cert.subject.split("\n");
    if (!names.includes(`CN=${PICKER_CA_COMMON_NAME}`)) return false;
    if (names.filter(line => line.startsWith("CN=")).length !== 1) return false;
    // A picker authority is self-issued and self-signed; a foreign issuer is not one of ours.
    if (cert.issuer !== cert.subject || !cert.verify(cert.publicKey)) return false;
    const root = readDer(cert.raw, 0);
    const certificate = root?.tag === 0x30 && root.next === cert.raw.length ? children(root.body) : null;
    const tbs = certificate?.[0]?.tag === 0x30 ? children(certificate[0].body) : null;
    const extensionField = tbs?.find(item => item.tag === 0xa3);
    const wrapped = extensionField && readDer(extensionField.body, 0);
    const extensions = wrapped?.tag === 0x30 && wrapped.next === extensionField!.body.length
      ? children(wrapped.body) : null;
    return extensions !== null && acceptsExtensionProfile(extensions);
  } catch {
    return false;
  }
}

/** Atomically publish a public certificate; these files carry no key material. */
function publishPem(path: string, pem: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, pem, { mode: 0o644 });
  try { chmodSync(tmp, 0o644); } catch { /* best-effort on platforms without POSIX modes */ }
  renameSync(tmp, path);
}

/**
 * Publish this process's authority and record which pid owns it, so another process that shares
 * the config directory can distinguish "the file went missing or stale" from "a live peer rotated
 * the authority" — only the former may be overwritten.
 */
function publishAuthority(configDir: string, ca: PickerCa): void {
  publishPem(pickerCaCertPath(configDir), ca.certPem);
  publishPem(pickerCaOwnerPath(configDir), JSON.stringify({ pid: process.pid, sha256: ca.fingerprint }) + "\n");
}

function foreignProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not signallable by us; ESRCH means it is gone.
    return error !== null && typeof error === "object" && (error as { code?: unknown }).code === "EPERM";
  }
}

/**
 * True when the published certificate belongs to a different live process's authority. The owner
 * record is only trusted while it describes the certificate actually on disk: a stale or
 * third-party `ca-owner.json` cannot shield a file that was tampered with after the owner wrote it.
 */
function foreignLiveOwner(configDir: string, published: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(pickerCaOwnerPath(configDir), "utf8")) as unknown;
    if (owner === null || typeof owner !== "object") return false;
    const { pid, sha256 } = owner as { pid?: unknown; sha256?: unknown };
    if (typeof pid !== "number" || typeof sha256 !== "string") return false;
    if (sha256 !== pickerCaFingerprints(published).sha256) return false;
    return foreignProcessAlive(pid);
  } catch {
    return false;
  }
}

/**
 * `check` runs under a cross-process lock keyed to the picker state dir so the read-decide-publish
 * sequence cannot interleave with a peer's. Returns undefined when the lock cannot be taken, and
 * callers then run the same step without it. For a cached authority that step still defers to a
 * live foreign owner. A fresh authority publishes unconditionally, with or without the lock; the
 * peer it displaces sees the new owner record and stops republishing.
 */
function underPickerCaLock<T>(configDir: string, check: () => T): T | undefined {
  try {
    return withClientLifecycleSync(check, { lockPath: pickerCaLockPath(configDir) });
  } catch {
    return undefined;
  }
}

/**
 * Drop the legacy exportable signing key, if one exists in the picker state dir. Releases before
 * the process-scoped authority persisted `ca.key` next to `ca.pem`; the removal is deliberately
 * unconditional so a later failed rotation can never leave that key behind.
 */
export function discardPickerCaKey(configDir: string): void {
  rmSync(join(pickerStateDir(configDir), "ca.key"), { force: true });
}

export function ensurePickerCa(configDir: string): PickerCa {
  const dir = pickerStateDir(configDir);
  // The signing key must never survive this process: another process under the same user could
  // otherwise steal it and later take over the predictable loopback proxy. Drop a key left (or
  // restored) by an older release on every call, including cache hits.
  discardPickerCaKey(configDir);
  const path = pickerCaCertPath(configDir);
  const cached = processAuthorities.get(dir);
  if (cached) {
    // The published certificate is this authority's public face. If it went missing, republish;
    // if a *live* peer rotated it, defer to the owner record — republishing a certificate another
    // process still serves would re-point trust inspection at an authority that process controls.
    const republishUnlessForeignOwned = (): void => {
      let published: string | null = null;
      try { published = readFileSync(path, "utf8"); } catch { /* missing or unreadable: republish */ }
      if (published === cached.certPem) return;
      if (published !== null && foreignLiveOwner(configDir, published)) return;
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      publishAuthority(configDir, cached);
    };
    if (underPickerCaLock(configDir, republishUnlessForeignOwned) === undefined) {
      republishUnlessForeignOwned();
    }
    return cached;
  }
  const ca = createCertificateAuthority({ commonName: PICKER_CA_COMMON_NAME, permittedDnsNames: [PICKER_HOST] });
  const pickerCa = { ...ca, fingerprint: pickerCaFingerprints(ca.certPem).sha256 };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // This process is a fresh authority: publish unconditionally. A peer whose cert we just
  // replaced will observe the divergence against our live owner record and stop republishing.
  const publish = (): void => { publishAuthority(configDir, pickerCa); };
  if (underPickerCaLock(configDir, publish) === undefined) publish();
  processAuthorities.set(dir, pickerCa);
  return pickerCa;
}

/** Fingerprint of this process's authority only — null until ensurePickerCa has run. */
export function publishedPickerCaSha256(configDir: string): string | null {
  const cached = processAuthorities.get(pickerStateDir(configDir));
  return cached ? pickerCaFingerprints(cached.certPem).sha256 : null;
}

/** Persist only the public leaf, so trust inspection verifies this exact local issuer. */
export function issuePickerLeaf(ca: PickerCa, configDir: string): PemKeyPair {
  const leaf = issueServerLeaf(ca, PICKER_CA_COMMON_NAME, [PICKER_HOST]);
  mkdirSync(pickerStateDir(configDir), { recursive: true, mode: 0o700 });
  publishPem(pickerLeafCertPath(configDir), leaf.certPem);
  return leaf;
}
