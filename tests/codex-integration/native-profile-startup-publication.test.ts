import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { publishFixtureFile } from "../helpers/fixture-file-publisher";

test("fixture publication refuses a pre-positioned temporary symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "ocx-fixture-publish-"));
  try {
    const marker = join(root, "settled");
    const victim = join(root, "victim");
    writeFileSync(victim, "original", "utf8");
    symlinkSync(victim, `${marker}.${process.pid}.tmp`);

    expect(() => publishFixtureFile(marker, "replacement")).toThrow();
    expect(readFileSync(victim, "utf8")).toBe("original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
