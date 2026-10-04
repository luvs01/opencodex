import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OcxConfig } from "../../src/types";
import type { GuiSessionState } from "../../src/server/gui-session";
import { GUI_PAIR_BROWSER_ORIGIN_HEADER, GUI_PAIR_CAPABILITY_HEADER } from "../../src/lib/gui-pair-capability";
import { consumeGuiPairIntent, createGuiPairIntent, GUI_PAIR_INTENT_HEADER } from "../../src/lib/gui-pair-intent";
import { deliverGuiPairingGrant, GuiPairingIntentRequiredError } from "../../src/server/gui-pair-delivery";
import { setAsyncIcaclsRunnerForTests, setIcaclsRunnerForTests } from "../../src/lib/windows-secret-acl";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const ORIGIN = "http://127.0.0.1:10100";
const CAP = "A".repeat(43);
const config = (): OcxConfig => ({ providers: {}, runtimeRole: "standalone", hostname: "127.0.0.1", port: 10100 } as OcxConfig);
const state = (): GuiSessionState => ({ sessions: new Map(), pairingGrants: new Map() });
const request = (proof?: string, origin = ORIGIN, capability = CAP) => new Request(`${ORIGIN}/api/gui/pairing-grants`, {
  method: "POST", headers: {
    [GUI_PAIR_BROWSER_ORIGIN_HEADER]: origin, [GUI_PAIR_CAPABILITY_HEADER]: capability,
    ...(proof ? { [GUI_PAIR_INTENT_HEADER]: proof } : {}),
  },
});
let root: string;
let previous: string | undefined;
const recordPath = () => join(root, "gui-pair-intents", readdirSync(join(root, "gui-pair-intents"))[0]!);
const ICACLS_OK = { success: true, exitCode: 0, timedOut: false, stdout: "" };

beforeEach(() => {
  previous = process.env.OPENCODEX_HOME;
  root = mkdtempSync(join(tmpdir(), "ocx-pair-intent-"));
  process.env.OPENCODEX_HOME = root;
  setIcaclsRunnerForTests(() => ICACLS_OK);
  setAsyncIcaclsRunnerForTests(async () => ICACLS_OK);
});
afterEach(() => {
  setIcaclsRunnerForTests(null); setAsyncIcaclsRunnerForTests(null);
  if (previous === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = previous;
  removeTreeWithRetry(root);
});

describe("one-use local CLI pairing intent", () => {
  test("a headless CLI intent permits one grant without creating a session", () => {
    const intent = createGuiPairIntent(CAP), s = state();
    try {
      const result = deliverGuiPairingGrant(request(intent.proof), config(), s);
      expect(typeof result.grant === "string" && result.grant.startsWith("ocx_pair_")).toBe(true);
      expect(result.browserOrigin).toBe(ORIGIN);
      expect(s.pairingGrants.size).toBe(1); expect(s.sessions.size).toBe(0);
      expect(() => deliverGuiPairingGrant(request(intent.proof), config(), s)).toThrow(GuiPairingIntentRequiredError);
      expect(s.pairingGrants.size).toBe(1);
    } finally { intent.dispose(); }
  });
  test("runtime capability alone never grants standalone pairing", () => {
    const s = state();
    expect(() => deliverGuiPairingGrant(request(), config(), s)).toThrow(GuiPairingIntentRequiredError);
    expect(() => deliverGuiPairingGrant(request("B".repeat(43)), config(), s)).toThrow(GuiPairingIntentRequiredError);
    expect(s.pairingGrants.size).toBe(0);
    expect(existsSync(join(root, "gui-pair-intents"))).toBe(false);
  });
  test("disk readers obtain only a hash, not a usable verifier", () => {
    const intent = createGuiPairIntent(CAP);
    try {
      const disk = readFileSync(recordPath(), "utf8");
      expect(/^[a-f0-9]{64}\n$/.test(disk)).toBe(true);
      expect(disk.includes(intent.proof)).toBe(false);
      expect(consumeGuiPairIntent(CAP, disk.trim())).toBe(false);
      expect(consumeGuiPairIntent(CAP, disk.slice(0, 43))).toBe(false);
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(true);
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(false);
    } finally { intent.dispose(); }
  });
  test("a guessed proof or different signed capability cannot consume the record", () => {
    const intent = createGuiPairIntent(CAP);
    try {
      expect(consumeGuiPairIntent(CAP, "B".repeat(43))).toBe(false);
      expect(consumeGuiPairIntent("C".repeat(43), intent.proof)).toBe(false);
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(true);
    } finally { intent.dispose(); }
  });
  test("a mismatched origin refuses before consuming local intent", () => {
    const intent = createGuiPairIntent(CAP), s = state();
    try {
      expect(() => deliverGuiPairingGrant(request(intent.proof, "http://127.0.0.1:10200"), config(), s)).toThrow();
      expect(s.pairingGrants.size).toBe(0);
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(true);
    } finally { intent.dispose(); }
  });
  test("client roles and wildcard binds do not become pairing targets", () => {
    const intent = createGuiPairIntent(CAP);
    try {
      const client = config(); client.runtimeRole = "client";
      const wildcard = config(); wildcard.hostname = "0.0.0.0";
      for (const cfg of [client, wildcard]) expect(() => deliverGuiPairingGrant(request(intent.proof), cfg, state())).toThrow();
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(true);
    } finally { intent.dispose(); }
  });
  test("a later command removes records abandoned by interrupted runs", () => {
    const dir = join(root, "gui-pair-intents");
    const abandoned = createGuiPairIntent(CAP), abandonedPath = recordPath();
    utimesSync(abandonedPath, new Date(0), new Date(0));
    const intent = createGuiPairIntent("C".repeat(43));
    try {
      expect(existsSync(abandonedPath)).toBe(false);
      expect(readdirSync(dir)).toHaveLength(1);
      expect(consumeGuiPairIntent("C".repeat(43), intent.proof)).toBe(true);
    } finally { intent.dispose(); abandoned.dispose(); }
  });
  test("sweeping never removes a fresh record an active command still holds", () => {
    const first = createGuiPairIntent(CAP);
    const second = createGuiPairIntent("C".repeat(43));
    try {
      expect(readdirSync(join(root, "gui-pair-intents"))).toHaveLength(2);
      expect(consumeGuiPairIntent(CAP, first.proof)).toBe(true);
      expect(consumeGuiPairIntent("C".repeat(43), second.proof)).toBe(true);
    } finally { first.dispose(); second.dispose(); }
  });
  test("sweeping leaves foreign and unsafe entries alone", () => {
    const dir = join(root, "gui-pair-intents");
    const intent = createGuiPairIntent(CAP);
    try {
      const foreign = join(dir, "not-an-intent");
      writeFileSync(foreign, "x".repeat(65), { mode: 0o600 });
      utimesSync(foreign, new Date(0), new Date(0));
      const staleShape = join(dir, "f".repeat(64));
      writeFileSync(staleShape, "x".repeat(65), { mode: 0o600 });
      utimesSync(staleShape, new Date(0), new Date(0));
      const replacement = join(dir, "e".repeat(64));
      writeFileSync(replacement, "x".repeat(65), { mode: 0o600 });
      utimesSync(replacement, new Date(0), new Date(0));
      linkSync(replacement, join(root, "extra-link"));
      createGuiPairIntent("C".repeat(43)).dispose();
      expect(existsSync(foreign)).toBe(true);
      expect(existsSync(staleShape)).toBe(false);
      expect(existsSync(replacement)).toBe(true); // hard-linked records are never unlinked
      unlinkSync(join(root, "extra-link"));
    } finally { intent.dispose(); }
  });
  test("dispose removes an unused commitment and is idempotent", () => {
    const intent = createGuiPairIntent(CAP), path = recordPath();
    intent.dispose(); intent.dispose();
    expect(existsSync(path)).toBe(false);
    expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(false);
  });
  test("publication never overwrites an existing commitment", () => {
    const intent = createGuiPairIntent(CAP), path = recordPath();
    try {
      const original = readFileSync(path, "utf8");
      expect(() => createGuiPairIntent(CAP)).toThrow();
      expect(readFileSync(path, "utf8") === original).toBe(true);
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(true);
    } finally { intent.dispose(); }
  });
  test("rejects oversized and corrupted records", () => {
    for (const data of ["x".repeat(4096), "x".repeat(65)]) {
      const intent = createGuiPairIntent(CAP), path = recordPath();
      writeFileSync(path, data);
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(false);
      intent.dispose(); // a replacement must be retained, not deleted by stale ownership
      expect(existsSync(path)).toBe(true);
      unlinkSync(path);
    }
  });
  test("rejects linked records without deleting the target", () => {
    const intent = createGuiPairIntent(CAP), path = recordPath(), other = join(root, "hard-link");
    try {
      linkSync(path, other);
      expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(false);
      expect(existsSync(other)).toBe(true);
    } finally { intent.dispose(); }
  });
  test.skipIf(process.platform === "win32")("rejects symlinked records and directories", () => {
    const intent = createGuiPairIntent(CAP), path = recordPath(), target = join(root, "target");
    writeFileSync(target, readFileSync(path)); unlinkSync(path); symlinkSync(target, path);
    expect(consumeGuiPairIntent(CAP, intent.proof)).toBe(false);
    intent.dispose(); expect(existsSync(target)).toBe(true); unlinkSync(path);
    const second = mkdtempSync(join(root, "second-")); symlinkSync(join(root, "gui-pair-intents"), join(second, "gui-pair-intents"));
    expect(() => createGuiPairIntent(CAP, second)).toThrow();
  });
  test.skipIf(process.platform === "win32")("rejects group-writable intent directories", () => {
    mkdirSync(join(root, "gui-pair-intents")); chmodSync(join(root, "gui-pair-intents"), 0o770);
    expect(() => createGuiPairIntent(CAP)).toThrow();
    expect(consumeGuiPairIntent(CAP, "B".repeat(43))).toBe(false);
  });
  test("invalid capability values never select a filesystem path", () => {
    for (const value of ["", "../outside", "x".repeat(1024)]) {
      expect(() => createGuiPairIntent(value)).toThrow();
      expect(consumeGuiPairIntent(value, "B".repeat(43))).toBe(false);
    }
  });
  test("hub invitations retain their existing policy and response", () => {
    const cfg = config(); cfg.runtimeRole = "hub";
    cfg.hub = { managementPublicOrigin: "https://hub.example" } as OcxConfig["hub"];
    const result = deliverGuiPairingGrant(request(undefined, "https://hub.example"), cfg, state());
    expect(result).toHaveProperty("grant");
    expect(existsSync(join(root, "gui-pair-intents"))).toBe(false);
  });
});
