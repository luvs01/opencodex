import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import * as keychain from "../../src/claude/keychain";
import { detectClaudeCodeToken, detectClaudeCodeTokenAsync } from "../../src/oauth/local-token-detect";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const payload = (generation: string) => JSON.stringify({
  claudeAiOauth: { accessToken: `fixture-access-${generation}`, refreshToken: `fixture-refresh-${generation}`, expiresAt: 1234 },
});
let home: string;
let previousConfig: string | undefined;
let homeSpy: ReturnType<typeof spyOn>;
let syncRead: ReturnType<typeof spyOn<typeof keychain, "readClaudeKeychain">>;
let asyncRead: ReturnType<typeof spyOn<typeof keychain, "readClaudeKeychainAsync">>;

beforeEach(() => {
  home = mkdtempSync(join(os.tmpdir(), "ocx-keychain-fallback-"));
  previousConfig = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  homeSpy = spyOn(os, "homedir").mockReturnValue(home);
  syncRead = spyOn(keychain, "readClaudeKeychain").mockReturnValue(null);
  asyncRead = spyOn(keychain, "readClaudeKeychainAsync").mockResolvedValue(null);
});

afterEach(() => {
  syncRead.mockRestore();
  asyncRead.mockRestore();
  homeSpy.mockRestore();
  if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfig;
  removeTreeWithRetry(home);
});

function credentialsFile(raw: string, profile = ".claude"): string {
  const dir = join(home, profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".credentials.json"), raw);
  return dir;
}

for (const variant of ["sync", "async"] as const) {
  describe(`${variant} Claude Keychain integration`, () => {
    const detect = () => variant === "sync" ? detectClaudeCodeToken() : detectClaudeCodeTokenAsync();
    function keychainResult(raw: string | null): void {
      syncRead.mockReturnValue(raw);
      asyncRead.mockResolvedValue(raw);
    }

    test("default profile prefers the Keychain over the credentials file", async () => {
      credentialsFile(payload("file"));
      keychainResult(payload("keychain"));
      expect((await detect())?.access).toBe("fixture-access-keychain");
      expect(variant === "sync" ? syncRead : asyncRead).toHaveBeenCalledTimes(1);
      expect(variant === "sync" ? asyncRead : syncRead).not.toHaveBeenCalled();
    });

    test("an unavailable Keychain falls back to the credentials file", async () => {
      credentialsFile(payload("file"));
      expect((await detect())?.access).toBe("fixture-access-file");
    });

    test("an explicit profile file wins without starting a Keychain query", async () => {
      process.env.CLAUDE_CONFIG_DIR = credentialsFile(payload("profile"), "separate-profile");
      keychainResult(payload("keychain"));
      expect((await detect())?.access).toBe("fixture-access-profile");
      expect(syncRead).not.toHaveBeenCalled();
      expect(asyncRead).not.toHaveBeenCalled();
    });

    test("a missing explicit profile file still permits the existing Keychain fallback", async () => {
      process.env.CLAUDE_CONFIG_DIR = join(home, "missing-profile");
      keychainResult(payload("keychain"));
      expect((await detect())?.access).toBe("fixture-access-keychain");
    });

    test("missing sources return null", async () => {
      expect(await detect()).toBeNull();
    });

    test("invalid Keychain JSON does not silently select another account's file", async () => {
      credentialsFile(payload("file"));
      keychainResult("invalid-json");
      expect(await detect()).toBeNull();
    });

    test("an empty successful Keychain response retains the existing source-selection behavior", async () => {
      credentialsFile(payload("file"));
      syncRead.mockReturnValue("");
      // The asynchronous reader has always normalized empty stdout to null.
      asyncRead.mockResolvedValue(null);
      const result = await detect();
      if (variant === "sync") expect(result).toBeNull();
      else expect(result?.access).toBe("fixture-access-file");
    });

    test("invalid explicit-profile JSON does not silently select the default Keychain account", async () => {
      process.env.CLAUDE_CONFIG_DIR = credentialsFile("invalid-json", "separate-profile");
      keychainResult(payload("keychain"));
      expect(await detect()).toBeNull();
      expect(syncRead).not.toHaveBeenCalled();
      expect(asyncRead).not.toHaveBeenCalled();
    });

    test("independent reads observe changed token generations", async () => {
      keychainResult(payload("before"));
      expect((await detect())?.refresh).toBe("fixture-refresh-before");
      keychainResult(payload("after"));
      expect((await detect())?.refresh).toBe("fixture-refresh-after");
    });
  });
}
