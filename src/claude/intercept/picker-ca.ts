import { createHash, X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
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

export function pickerCaFingerprints(certPem: string): { sha1: string; sha256: string } {
  const der = new X509Certificate(certPem).raw;
  return {
    sha1: createHash("sha1").update(der).digest("hex").toUpperCase(),
    sha256: createHash("sha256").update(der).digest("hex").toUpperCase(),
  };
}

/** Atomically publish a public certificate; these files carry no key material. */
function publishPem(path: string, pem: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, pem, { mode: 0o644 });
  try { chmodSync(tmp, 0o644); } catch { /* best-effort on platforms without POSIX modes */ }
  renameSync(tmp, path);
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
  const cached = processAuthorities.get(dir);
  if (cached) {
    // The published certificate is this authority's public face. If it went missing or another
    // process rotated it, trust inspection and the CLI trust flow would verify against a
    // certificate this process cannot sign for, so publish this process's authority again.
    const path = pickerCaCertPath(configDir);
    let published: string | null = null;
    try { published = readFileSync(path, "utf8"); } catch { /* missing or unreadable: republish */ }
    if (published !== cached.certPem) publishPem(path, cached.certPem);
    return cached;
  }
  const ca = createCertificateAuthority({ commonName: PICKER_CA_COMMON_NAME, permittedDnsNames: [PICKER_HOST] });
  const pickerCa = { ...ca, fingerprint: pickerCaFingerprints(ca.certPem).sha256 };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Desktop trusts this authority in the login keychain. Only the public certificate is persisted.
  publishPem(pickerCaCertPath(configDir), ca.certPem);
  processAuthorities.set(dir, pickerCa);
  return pickerCa;
}

/** Persist only the public leaf, so trust inspection verifies this exact local issuer. */
export function issuePickerLeaf(ca: PickerCa, configDir: string): PemKeyPair {
  const leaf = issueServerLeaf(ca, PICKER_CA_COMMON_NAME, [PICKER_HOST]);
  mkdirSync(pickerStateDir(configDir), { recursive: true, mode: 0o700 });
  publishPem(pickerLeafCertPath(configDir), leaf.certPem);
  return leaf;
}
