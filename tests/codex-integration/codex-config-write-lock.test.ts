/**
 * Contract for src/codex/config-write-lock.ts: every opencodex-originated
 * config.toml write serializes through `<config>.ocx-write.lock`.
 *
 * The lock primitive itself is prompt-lock's, covered by codex-prompt-lock.
 * These tests pin the part that is NEW here: each writer honors the shared
 * lock — while another holder has it the writer refuses fast and leaves the
 * file byte-identical — and a caller that already holds the file can pass its
 * handle through (`heldConfigWriteLock`) so a nested writer does not refuse
 * itself inside the caller's wider section.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireConfigWriteLock,
  CONFIG_WRITE_LOCKED_MESSAGE,
  configWriteLockPath,
  releaseConfigWriteLock,
  withConfigWriteLock,
  withConfigWriteLockHeld,
} from "../../src/codex/config-write-lock";
import { release, tryAcquire, type LockDeps, type LockHandle } from "../../src/codex/prompt-lock";
import {
  isMultiAgentV2Enabled,
  setAgentsEnabled,
  setMaxConcurrentThreads,
  setMultiAgentModeHintText,
  transitionMultiAgentV2,
} from "../../src/codex/features";
import { readPromptLayers, setToggle } from "../../src/codex/prompt-layers";
import { removeTreeWithRetry } from "../helpers/remove-tree";

const roots: string[] = [];
const alive: LockDeps = { isProcessAlive: () => true, now: () => Date.now() };

function fixtureConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ocx-cfglock-"));
  roots.push(dir);
  const path = join(dir, "config.toml");
  writeFileSync(path, content);
  return path;
}

/** Hold the shared write lock on `configPath` from outside the writer under test. */
function holdLock(configPath: string): LockHandle {
  const acquired = tryAcquire(configWriteLockPath(configPath), alive);
  if (!acquired.ok) throw new Error("setup: could not take the lock under test");
  return acquired.handle;
}

afterEach(() => {
  while (roots.length) removeTreeWithRetry(roots.pop()!);
});

describe("withConfigWriteLock", () => {
  test("runs the section and releases when the file is free", () => {
    const path = fixtureConfig("[agents]\nmax_threads = 2\n");
    const locked = withConfigWriteLock(path, () => "done");
    expect(locked).toEqual({ ok: true, value: "done" });
    expect(existsSync(configWriteLockPath(path))).toBe(false);
  });

  test("refuses fast while another holder owns the file", () => {
    const path = fixtureConfig("[agents]\nmax_threads = 2\n");
    holdLock(path);
    expect(withConfigWriteLock(path, () => "done")).toEqual({ ok: false, error: "locked" });
  });

  test("a throwing section still releases the lock", () => {
    const path = fixtureConfig("");
    expect(() => withConfigWriteLock(path, () => { throw new Error("boom"); })).toThrow("boom");
    expect(withConfigWriteLock(path, () => "again")).toEqual({ ok: true, value: "again" });
  });
});

describe("withConfigWriteLockHeld", () => {
  test("a caller-held handle runs the section without re-acquiring", () => {
    const path = fixtureConfig("x = 1\n");
    const handle = holdLock(path);
    const ran = withConfigWriteLockHeld(path, handle, () => "inside the held lock");
    expect(ran).toEqual({ ok: true, value: "inside the held lock" });
    release(handle);
  });

  test("a superseded handle is refused, not silently trusted", () => {
    const path = fixtureConfig("x = 1\n");
    const handle = holdLock(path);
    release(handle);
    // A released handle means someone else may own the path now — the section
    // must not run under it.
    expect(withConfigWriteLockHeld(path, handle, () => "no")).toEqual({ ok: false, error: "locked" });
  });

  test("a handle minted on another config's lock is refused", () => {
    const path = fixtureConfig("x = 1\n");
    const other = fixtureConfig("y = 2\n");
    // Live handle, wrong lock path: running under it would leave `path`'s
    // writes unserialized while its own holders correctly believe it is free.
    const foreign = holdLock(other);
    try {
      expect(withConfigWriteLockHeld(path, foreign, () => "no")).toEqual({ ok: false, error: "locked" });
    } finally {
      release(foreign);
    }
  });
});

describe("acquireConfigWriteLock", () => {
  test("async callers take the file immediately when free", async () => {
    const path = fixtureConfig("x = 1\n");
    const acquired = await acquireConfigWriteLock(path, { timeoutMs: 50 });
    expect(acquired.ok).toBe(true);
    if (acquired.ok) releaseConfigWriteLock(acquired.handle);
  });

  test("async callers give up after the bounded wait", async () => {
    const path = fixtureConfig("x = 1\n");
    holdLock(path);
    const acquired = await acquireConfigWriteLock(path, { timeoutMs: 50 });
    expect(acquired).toEqual({ ok: false, error: "locked" });
  });
});

describe("every writer honors the shared lock", () => {
  test("setMaxConcurrentThreads refuses busy and leaves bytes identical", () => {
    const path = fixtureConfig("[features.multi_agent_v2]\nenabled = true\nmax_concurrent_threads_per_session = 4\n");
    const before = readFileSync(path, "utf8");
    holdLock(path);
    expect(setMaxConcurrentThreads(9, path)).toEqual({ ok: false, error: CONFIG_WRITE_LOCKED_MESSAGE });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("setAgentsEnabled refuses busy", () => {
    const path = fixtureConfig("[agents]\nmax_threads = 2\n");
    const before = readFileSync(path, "utf8");
    holdLock(path);
    expect(setAgentsEnabled(false, path)).toEqual({ ok: false, error: CONFIG_WRITE_LOCKED_MESSAGE });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("setMultiAgentModeHintText refuses busy", () => {
    const path = fixtureConfig("[features.multi_agent_v2]\nenabled = true\n");
    const before = readFileSync(path, "utf8");
    holdLock(path);
    expect(setMultiAgentModeHintText("hint", path)).toEqual({ ok: false, error: CONFIG_WRITE_LOCKED_MESSAGE });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("transitionMultiAgentV2 refuses busy without running the toggle", () => {
    const path = fixtureConfig("[features.multi_agent_v2]\nenabled = true\n");
    const before = readFileSync(path, "utf8");
    holdLock(path);
    let toggled = false;
    const result = transitionMultiAgentV2(false, () => { toggled = true; }, { configPath: path });
    expect(result).toEqual({ ok: false, error: CONFIG_WRITE_LOCKED_MESSAGE });
    expect(toggled).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("a prompt-layer commit refuses while the config write lock is held", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocx-cfglock-prompt-"));
    roots.push(dir);
    const configPath = join(dir, "config.toml");
    const storePath = join(dir, "opencodex-prompt.json");
    const paths = { configPath, storePath };
    const before = readPromptLayers(paths);
    holdLock(configPath);
    const result = setToggle("apps", false, before.revision, paths);
    expect(result).toEqual({ ok: false, error: "locked" });
    expect(existsSync(configPath)).toBe(false);
  });
});

describe("heldConfigWriteLock handoff", () => {
  test("transitionMultiAgentV2 runs under a caller-held lock", () => {
    const path = fixtureConfig("[features.multi_agent_v2]\nenabled = true\nmax_concurrent_threads_per_session = 64\n\n[agents]\nmax_depth = 2\n");
    const flipTableFlag = (enabled: boolean) => {
      const content = readFileSync(path, "utf8");
      writeFileSync(path, content.replace(/^enabled\s*=\s*(?:true|false)$/m, `enabled = ${enabled}`));
    };
    const handle = holdLock(path);
    // The transition is a nested writer inside the injector's held section: it
    // must run on the caller's handle rather than refusing itself.
    const result = transitionMultiAgentV2(false, flipTableFlag, { configPath: path, heldConfigWriteLock: handle });
    expect(result).toMatchObject({ ok: true, changed: true, threadLimit: 63 });
    expect(isMultiAgentV2Enabled(path)).toBe(false);
    release(handle);
  });

  test("transitionMultiAgentV2 refuses a superseded caller handle", () => {
    const path = fixtureConfig("[features.multi_agent_v2]\nenabled = true\n");
    const before = readFileSync(path, "utf8");
    const handle = holdLock(path);
    release(handle);
    const result = transitionMultiAgentV2(false, () => { throw new Error("toggle must not run"); }, {
      configPath: path,
      heldConfigWriteLock: handle,
    });
    expect(result).toEqual({ ok: false, error: CONFIG_WRITE_LOCKED_MESSAGE });
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("scalar writers run under a caller-held lock (route batch)", () => {
    const path = fixtureConfig("[agents]\nmax_threads = 2\n");
    const handle = holdLock(path);
    try {
      // The management PUT hands its single acquired lock to every scalar
      // writer — each must apply under it instead of refusing itself.
      expect(setAgentsEnabled(false, path, handle)).toEqual({ ok: true, changed: true });
      expect(readFileSync(path, "utf8")).toContain("enabled = false");
    } finally {
      release(handle);
    }
  });
});

describe("grok config.toml coverage", () => {
  const grokConfig = "model = \"grok-4\"\n";

  function fixtureGrokHome(content: string): { home: string; configPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "ocx-cfglock-grok-"));
    roots.push(dir);
    const configPath = join(dir, "config.toml");
    writeFileSync(configPath, content);
    return { home: dir, configPath };
  }

  test("injectGrokConfig refuses fast while a holder owns ~/.grok's write lock", async () => {
    const { home, configPath } = fixtureGrokHome(grokConfig);
    const handle = holdLock(configPath);
    const { injectGrokConfig } = await import("../../src/grok/inject");
    const result = injectGrokConfig(10100, [{ id: "gpt-5.6-sol" }], { grokHome: home });
    expect(result.ok).toBe(false);
    expect(result.skippedReason).toBe("locked");
    expect(readFileSync(configPath, "utf8")).toBe(grokConfig);
    release(handle);
  });

  test("stripGrokConfig honors the same lock on its cleanup write", async () => {
    const { home, configPath } = fixtureGrokHome(grokConfig);
    const handle = holdLock(configPath);
    const { stripGrokConfig } = await import("../../src/grok/inject");
    const result = stripGrokConfig({ grokHome: home });
    expect(result.ok).toBe(false);
    expect(result.skippedReason).toBe("locked");
    expect(readFileSync(configPath, "utf8")).toBe(grokConfig);
    release(handle);
  });
});
