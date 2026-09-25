import { createHash, X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

export function ensurePickerCa(configDir: string): PickerCa {
  const dir = pickerStateDir(configDir);
  const cached = processAuthorities.get(dir);
  if (cached) return cached;
  const ca = createCertificateAuthority({ commonName: PICKER_CA_COMMON_NAME, permittedDnsNames: [PICKER_HOST] });
  const pickerCa = { ...ca, fingerprint: pickerCaFingerprints(ca.certPem).sha256 };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Desktop trusts this authority in the login keychain. Its signing key must never survive this
  // process: another process under the same user could otherwise steal it and later take over the
  // predictable loopback proxy. Remove keys left by older releases during the rotation.
  rmSync(join(dir, "ca.key"), { force: true });
  const path = pickerCaCertPath(configDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, ca.certPem, { mode: 0o644 });
  try { chmodSync(tmp, 0o644); } catch { /* best-effort on platforms without POSIX modes */ }
  renameSync(tmp, path);
  processAuthorities.set(dir, pickerCa);
  return pickerCa;
}

/** Persist only the public leaf, so trust inspection verifies this exact local issuer. */
export function issuePickerLeaf(ca: PickerCa, configDir: string): PemKeyPair {
  const leaf = issueServerLeaf(ca, PICKER_CA_COMMON_NAME, [PICKER_HOST]);
  const path = pickerLeafCertPath(configDir);
  mkdirSync(pickerStateDir(configDir), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, leaf.certPem, { mode: 0o644 });
  try { chmodSync(tmp, 0o644); } catch { /* best-effort on platforms without POSIX modes */ }
  renameSync(tmp, path);
  return leaf;
}
