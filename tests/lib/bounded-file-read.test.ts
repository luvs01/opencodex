import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "../helpers/repo-root";
import { readBoundedRegularFileSync } from "../../src/lib/bounded-file-read";

const repoRoot = repoPath();
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ocx-bounded-read-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readBoundedRegularFileSync", () => {
  test("reads a bounded regular file", () => {
    const path = join(root, "config.json");
    writeFileSync(path, '{"ok":true}');
    expect(readBoundedRegularFileSync(path, 32).toString("utf8")).toBe(readFileSync(path, "utf8"));
  });

  test("rejects oversized files and final symlinks", () => {
    const path = join(root, "large.json");
    writeFileSync(path, "x".repeat(33));
    expect(() => readBoundedRegularFileSync(path, 32)).toThrow();

    const link = join(root, "linked.json");
    symlinkSync(path, link, "file");
    expect(() => readBoundedRegularFileSync(link, 64)).toThrow();
  });

  test.skipIf(process.platform === "win32")("rejects a FIFO without blocking", () => {
    const fifo = join(root, "input.pipe");
    const created = spawnSync("mkfifo", [fifo], { timeout: 2_000 });
    expect(created.status).toBe(0);
    const result = spawnSync(process.execPath, ["--eval", `
      const { readBoundedRegularFileSync } = require("./src/lib/bounded-file-read.ts");
      try { readBoundedRegularFileSync(process.env.BOUNDED_READ_FIFO, 1024); process.exitCode = 2; }
      catch { process.exitCode = 0; }
    `], {
      cwd: repoRoot,
      env: { ...process.env, BOUNDED_READ_FIFO: fifo },
      timeout: 2_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
});
