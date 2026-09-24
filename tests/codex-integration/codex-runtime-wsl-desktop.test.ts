import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCodexRuntime } from "../../src/codex/runtime";

const CODEX_HOME = "/mnt/c/Users/example/.codex";
const PLANTED_RUNTIME = join(CODEX_HOME, "bin", "wsl", "attacker-newest", "codex");

function tempConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "ocx-runtime-wsl-"));
}

describe("WSL Desktop runtime trust boundary", () => {
  test("does not discover or execute a binary planted in the shared Codex home", () => {
    const executed: string[] = [];
    const listed: string[] = [];
    const result = resolveCodexRuntime({
      configDir: tempConfigDir(),
      env: { CODEX_HOME, HOME: "/home/example", PATH: "" },
      platform: "linux",
      existsSync: path => path === PLANTED_RUNTIME,
      readdirSync: path => {
        listed.push(path);
        return ["attacker-newest"];
      },
      statSync: () => ({ mtimeMs: 2_000, isDirectory: () => true }),
      execFileSync: file => {
        executed.push(String(file));
        if (file === PLANTED_RUNTIME) return "codex-cli 9.99.0";
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      },
      discoverAlternatives: false,
    });

    expect(listed).toEqual([]);
    expect(executed).not.toContain(PLANTED_RUNTIME);
    expect(result.runtime).toEqual({ command: "codex", version: null, source: "fallback" });
  });

  test("still accepts an explicitly selected WSL Desktop runtime", () => {
    const result = resolveCodexRuntime({
      configDir: tempConfigDir(),
      env: { CODEX_CLI_PATH: PLANTED_RUNTIME, CODEX_HOME, HOME: "/home/example", PATH: "" },
      platform: "linux",
      existsSync: path => path === PLANTED_RUNTIME,
      execFileSync: () => "codex-cli 0.155.0",
      discoverAlternatives: false,
    });

    expect(result.runtime).toEqual({
      command: PLANTED_RUNTIME,
      version: "0.155.0",
      source: "environment",
    });
  });
});
