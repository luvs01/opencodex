import { expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { connect, createServer } from "node:tls";
import { createCertificateAuthority, createLocalInterceptCa, issueServerLeaf, mintAuthorityWithExtensionsForTests } from "../../src/claude/intercept/local-ca";
import {
  acceptsPickerAuthority, ensurePickerCa, issuePickerLeaf, pickerCaCertPath, pickerCaFingerprints,
  pickerCaOwnerPath, pickerLeafCertPath, pickerStateDir, PICKER_CA_COMMON_NAME, PICKER_HOST,
} from "../../src/claude/intercept/picker-ca";

function tempDir(): string { return mkdtempSync(join(tmpdir(), "ocx-picker-ca-")); }

function der(bytes: Buffer, offset: number): { tag: number; body: Buffer; next: number } {
  const tag = bytes[offset]!;
  let length = bytes[offset + 1]!;
  let start = offset + 2;
  if (length & 0x80) {
    const width = length & 0x7f;
    length = 0;
    for (let i = 0; i < width; i++) length = length * 256 + bytes[start++]!;
  }
  return { tag, body: bytes.subarray(start, start + length), next: start + length };
}

function parts(bytes: Buffer): ReturnType<typeof der>[] {
  const items = [];
  for (let at = 0; at < bytes.length;) {
    const item = der(bytes, at);
    items.push(item);
    at = item.next;
  }
  return items;
}

function constraints(certPem: string): { critical: boolean; dnsNames: string[]; excludedIps: string[] } | null {
  const root = der(new X509Certificate(certPem).raw, 0);
  const tbs = parts(root.body)[0]!;
  const wrapper = parts(tbs.body).find(item => item.tag === 0xa3)!;
  const extensions = parts(der(wrapper.body, 0).body);
  const matched = extensions.map(item => parts(item.body)).find(fields =>
    fields[0]?.tag === 0x06 && fields[0].body.equals(Buffer.from([0x55, 0x1d, 0x1e])));
  if (!matched) return null;
  const nc = parts(der(matched.at(-1)!.body, 0).body);
  const permitted = nc.find(field => field.tag === 0xa0);
  const excluded = nc.find(field => field.tag === 0xa1);
  return {
    critical: matched[1]?.tag === 0x01 && matched[1].body.equals(Buffer.from([0xff])),
    dnsNames: permitted ? parts(permitted.body).flatMap(subtree =>
      parts(subtree.body).filter(base => base.tag === 0x82).map(base => base.body.toString("ascii"))) : [],
    excludedIps: excluded ? parts(excluded.body).flatMap(subtree =>
      parts(subtree.body).filter(base => base.tag === 0x87).map(base => base.body.toString("hex"))) : [],
  };
}

const ALL_IPS = ["00".repeat(8), "00".repeat(32)];

// ── acceptsPickerAuthority trust-boundary fixtures ─────────────────────────────
//
// Adversarial profiles are built by splicing real extension items out of certificates the
// production mint issues and re-minting them on a fresh self-signed authority, so every forged
// certificate still parses and verifies.

function rawTlvs(bytes: Buffer): Buffer[] {
  const items: Buffer[] = [];
  for (let at = 0; at < bytes.length;) {
    const item = der(bytes, at);
    items.push(bytes.subarray(at, item.next));
    at = item.next;
  }
  return items;
}

function extensionItems(certPem: string): Buffer[] {
  const root = der(new X509Certificate(certPem).raw, 0);
  const tbs = parts(root.body)[0]!;
  const wrapper = parts(tbs.body).find(item => item.tag === 0xa3)!;
  return rawTlvs(der(wrapper.body, 0).body);
}

function hasOid(oid: number[]): (item: Buffer) => boolean {
  return item => {
    const first = parts(der(item, 0).body)[0];
    return first?.tag === 0x06 && first.body.equals(Buffer.from(oid));
  };
}

const OID_BASIC_CONSTRAINTS = [0x55, 0x1d, 0x13];
const OID_KEY_USAGE = [0x55, 0x1d, 0x0f];
const OID_SUBJECT_KEY_IDENTIFIER = [0x55, 0x1d, 0x0e];
const OID_SUBJECT_ALT_NAME = [0x55, 0x1d, 0x11];
const OID_EXTENDED_KEY_USAGE = [0x55, 0x1d, 0x25];
const OID_NAME_CONSTRAINTS = [0x55, 0x1d, 0x1e];

function testTlv(tag: number, body: Buffer): Buffer {
  const head: number[] = [tag];
  if (body.length < 0x80) head.push(body.length);
  else if (body.length < 0x100) head.push(0x81, body.length);
  else head.push(0x82, body.length >> 8, body.length & 0xff);
  return Buffer.concat([Buffer.from(head), body]);
}

/** Re-encode an Extension SEQUENCE without its critical BOOLEAN (the non-critical form). */
function asNonCritical(extension: Buffer): Buffer {
  const fields = rawTlvs(der(extension, 0).body).filter(field => der(field, 0).tag !== 0x01);
  return testTlv(0x30, Buffer.concat(fields));
}

const mintPickerCa = () => createCertificateAuthority({ commonName: PICKER_CA_COMMON_NAME, permittedDnsNames: [PICKER_HOST] });
const mintedExtension = (certPem: string, oid: number[]) => extensionItems(certPem).find(hasOid(oid))!;
const forgeAuthority = (extensions: Buffer[]) =>
  mintAuthorityWithExtensionsForTests(PICKER_CA_COMMON_NAME, extensions).certPem;

test("acceptsPickerAuthority accepts the minted picker root and rejects other profiles", () => {
  expect(acceptsPickerAuthority(mintPickerCa().certPem)).toBe(true);
  expect(acceptsPickerAuthority(ensurePickerCa(tempDir()).certPem)).toBe(true);
  expect(acceptsPickerAuthority("not a certificate")).toBe(false);
  // A foreign common name with an otherwise valid constraint set is not a picker authority.
  expect(acceptsPickerAuthority(createCertificateAuthority({
    commonName: "other root", permittedDnsNames: [PICKER_HOST],
  }).certPem)).toBe(false);
});

test("acceptsPickerAuthority rejects relaxed name-constraint profiles", () => {
  // An additional permitted DNS subtree widens the root beyond claude.ai.
  expect(acceptsPickerAuthority(createCertificateAuthority({
    commonName: PICKER_CA_COMMON_NAME, permittedDnsNames: [PICKER_HOST, "example.com"],
  }).certPem)).toBe(false);
  // Without the all-IP exclusion the address-space name form stays unconstrained.
  expect(acceptsPickerAuthority(createCertificateAuthority({
    commonName: PICKER_CA_COMMON_NAME, permittedDnsNames: [PICKER_HOST], excludeAllIpAddresses: false,
  }).certPem)).toBe(false);
  // A non-critical nameConstraints extension may be ignored by consumers; it is not the profile.
  const items = extensionItems(mintPickerCa().certPem);
  expect(acceptsPickerAuthority(forgeAuthority(
    items.map(item => hasOid(OID_NAME_CONSTRAINTS)(item) ? asNonCritical(item) : item),
  ))).toBe(false);
});

test("acceptsPickerAuthority rejects leaf privileges or loosened CA bits on a picker-named root", () => {
  const legit = mintPickerCa();
  const leaf = issueServerLeaf(legit, PICKER_CA_COMMON_NAME, ["example.com"]);
  const bc = mintedExtension(legit.certPem, OID_BASIC_CONSTRAINTS);
  const keyUsage = mintedExtension(legit.certPem, OID_KEY_USAGE);
  const ski = mintedExtension(legit.certPem, OID_SUBJECT_KEY_IDENTIFIER);
  const nc = mintedExtension(legit.certPem, OID_NAME_CONSTRAINTS);
  // The spoofed-listener shape: right CN, right critical claude.ai constraint, plus leaf extras.
  expect(acceptsPickerAuthority(forgeAuthority([bc, keyUsage, ski, nc, mintedExtension(leaf.certPem, OID_SUBJECT_ALT_NAME)]))).toBe(false);
  expect(acceptsPickerAuthority(forgeAuthority([bc, keyUsage, ski, nc, mintedExtension(leaf.certPem, OID_EXTENDED_KEY_USAGE)]))).toBe(false);
  // Leaf-shaped key usage (digitalSignature) or a CA:FALSE constraint are not the profile.
  expect(acceptsPickerAuthority(forgeAuthority([bc, mintedExtension(leaf.certPem, OID_KEY_USAGE), ski, nc]))).toBe(false);
  expect(acceptsPickerAuthority(forgeAuthority([mintedExtension(leaf.certPem, OID_BASIC_CONSTRAINTS), keyUsage, ski, nc]))).toBe(false);
  // Dropping a required extension or duplicating one also breaks the profile.
  expect(acceptsPickerAuthority(forgeAuthority([bc, keyUsage, nc]))).toBe(false);
  expect(acceptsPickerAuthority(forgeAuthority([bc, keyUsage, ski, nc, nc]))).toBe(false);
});

test("picker root has a critical claude.ai-only DNS constraint that excludes every IP; intercept root remains unconstrained", () => {
  const ca = ensurePickerCa(tempDir());
  expect(new X509Certificate(ca.certPem).subject).toContain(`CN=${PICKER_CA_COMMON_NAME}`);
  expect(constraints(ca.certPem)).toEqual({ critical: true, dnsNames: [PICKER_HOST], excludedIps: ALL_IPS });
  expect(constraints(createLocalInterceptCa().certPem)).toBeNull();
  expect(ca.fingerprint).toBe(pickerCaFingerprints(ca.certPem).sha256);
  expect(pickerCaFingerprints(ca.certPem).sha1).toMatch(/^[0-9A-F]{40}$/);
});

test("picker leaf SAN is exactly claude.ai and verifies under its issuer", () => {
  const dir = tempDir();
  const ca = ensurePickerCa(dir);
  const leaf = issuePickerLeaf(ca, dir);
  const cert = new X509Certificate(leaf.certPem);
  expect(cert.subjectAltName).toBe("DNS:claude.ai");
  expect(cert.verify(ca.publicKey)).toBe(true);
  expect(cert.checkIssued(new X509Certificate(ca.certPem))).toBe(true);
  expect(readFileSync(pickerLeafCertPath(dir), "utf8")).toBe(leaf.certPem);
});

async function handshake(caPem: string, pair: { certPem: string; keyPem: string }, host: string): Promise<boolean> {
  const server = createServer({ cert: pair.certPem, key: pair.keyPem }, socket => socket.end());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test listener");
  try {
    return await new Promise<boolean>(resolve => {
      const socket = connect({ host: "127.0.0.1", port: address.port, servername: host,
        ca: caPem, rejectUnauthorized: true });
      socket.once("secureConnect", () => { resolve(socket.authorized); socket.destroy(); });
      socket.once("error", () => { resolve(false); socket.destroy(); });
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("TLS accepts claude.ai and rejects an off-host leaf issued by the picker root", async () => {
  const dir = tempDir();
  const ca = ensurePickerCa(dir);
  expect(await handshake(ca.certPem, issuePickerLeaf(ca, dir), PICKER_HOST)).toBe(true);
  const offHost = issueServerLeaf(ca, PICKER_CA_COMMON_NAME, ["example.com"]);
  expect(await handshake(ca.certPem, offHost, "example.com")).toBe(false);
});

async function ipHandshake(caPem: string, pair: { certPem: string; keyPem: string }): Promise<boolean> {
  const server = createServer({ cert: pair.certPem, key: pair.keyPem }, socket => socket.end());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test listener");
  try {
    return await new Promise<boolean>(resolve => {
      const socket = connect({ host: "127.0.0.1", port: address.port, ca: caPem, rejectUnauthorized: true });
      socket.once("secureConnect", () => { resolve(socket.authorized); socket.destroy(); });
      socket.once("error", () => { resolve(false); socket.destroy(); });
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("TLS rejects an IP-address leaf issued by the picker root", async () => {
  const ipLeaf = (ca: Parameters<typeof issueServerLeaf>[0]) => issueServerLeaf(ca, PICKER_CA_COMMON_NAME, ["127.0.0.1"]);
  expect(new X509Certificate(ipLeaf(createLocalInterceptCa()).certPem).subjectAltName).toBe("IP Address:127.0.0.1");
  // Control: the same leaf shape verifies under an unconstrained root.
  const unconstrained = createCertificateAuthority({ commonName: PICKER_CA_COMMON_NAME });
  expect(await ipHandshake(unconstrained.certPem, ipLeaf(unconstrained))).toBe(true);
  const ca = ensurePickerCa(tempDir());
  expect(await ipHandshake(ca.certPem, ipLeaf(ca))).toBe(false);
});

test("picker authority keeps its private key in process memory and removes a legacy key", () => {
  const dir = tempDir();
  const stateDir = pickerStateDir(dir);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "ca.key"), "legacy-exportable-key\n");
  const first = ensurePickerCa(dir);
  expect(ensurePickerCa(dir).fingerprint).toBe(first.fingerprint);
  expect(existsSync(join(stateDir, "ca.key"))).toBe(false);
  expect(constraints(readFileSync(pickerCaCertPath(dir), "utf8"))?.dnsNames).toEqual([PICKER_HOST]);
});

test("a cached authority still removes a restored legacy key and republishes a stale certificate", () => {
  const dir = tempDir();
  const stateDir = pickerStateDir(dir);
  const ca = ensurePickerCa(dir);
  // Another process published a different certificate while a legacy key reappeared on disk.
  writeFileSync(join(stateDir, "ca.key"), "legacy-exportable-key\n");
  writeFileSync(pickerCaCertPath(dir), createCertificateAuthority({
    commonName: PICKER_CA_COMMON_NAME, permittedDnsNames: [PICKER_HOST],
  }).certPem);
  expect(ensurePickerCa(dir).fingerprint).toBe(ca.fingerprint);
  expect(readFileSync(pickerCaCertPath(dir), "utf8")).toBe(ca.certPem);
  expect(existsSync(join(stateDir, "ca.key"))).toBe(false);
  // A certificate that went missing entirely is republished the same way.
  rmSync(pickerCaCertPath(dir));
  expect(ensurePickerCa(dir).fingerprint).toBe(ca.fingerprint);
  expect(readFileSync(pickerCaCertPath(dir), "utf8")).toBe(ca.certPem);
});

const PICKER_CA_MODULE_URL = pathToFileURL(join(import.meta.dir, "../../src/claude/intercept/picker-ca.ts")).href;

// The restart contract is process-scoped: a new process must mint its own authority, not reuse
// the previous one's certificate. This needs a real second process — the in-process authority
// cache would otherwise hand the same keypair back.
test("a second process mints a fresh authority and republishes it", () => {
  const dir = tempDir();
  const ours = ensurePickerCa(dir);
  const child = Bun.spawnSync({
    cmd: [process.execPath, "-e",
      `import { ensurePickerCa } from ${JSON.stringify(PICKER_CA_MODULE_URL)};\n` +
      `process.stdout.write(ensurePickerCa(${JSON.stringify(dir)}).fingerprint);`],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(child.exitCode).toBe(0);
  const childFingerprint = child.stdout.toString().trim();
  expect(childFingerprint).not.toBe(ours.fingerprint);
  // The newer process's authority is the published one.
  expect(pickerCaFingerprints(readFileSync(pickerCaCertPath(dir), "utf8")).sha256).toBe(childFingerprint);
});

test("a live foreign owner is never clobbered; a dead one is reclaimed", async () => {
  const dir = tempDir();
  const ours = ensurePickerCa(dir);
  const child = Bun.spawn({
    cmd: [process.execPath, "-e",
      `import { ensurePickerCa } from ${JSON.stringify(PICKER_CA_MODULE_URL)};\n` +
      `ensurePickerCa(${JSON.stringify(dir)}); setInterval(() => {}, 60000);`],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    // Wait until the child's authority is published with its owner record.
    const ownerPath = pickerCaOwnerPath(dir);
    let childFingerprint = "";
    for (let i = 0; i < 400; i += 1) {
      try {
        const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { pid?: number; sha256?: string };
        if (owner.pid === child.pid && typeof owner.sha256 === "string") { childFingerprint = owner.sha256; break; }
      } catch { /* owner file not written yet */ }
      await Bun.sleep(10);
    }
    expect(childFingerprint).not.toBe("");
    expect(childFingerprint).not.toBe(ours.fingerprint);
    // A live foreign process owns the published certificate: this process must not republish its
    // previously trusted authority over it.
    ensurePickerCa(dir);
    expect(pickerCaFingerprints(readFileSync(pickerCaCertPath(dir), "utf8")).sha256).toBe(childFingerprint);
    child.kill();
    await child.exited;
    // Once the owner is gone the file is stale again and this process reclaims it.
    ensurePickerCa(dir);
    expect(readFileSync(pickerCaCertPath(dir), "utf8")).toBe(ours.certPem);
  } finally {
    child.kill();
  }
});
