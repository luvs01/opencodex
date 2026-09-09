import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("setup-hooks", () => {
  test("refuses to modify a configured shared hooksPath", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencodex-setup-hooks-"));
    temporaryDirectories.push(directory);
    const hooksDirectory = join(directory, "shared-hooks");
    const configPath = join(directory, "gitconfig");
    const existingHook = join(hooksDirectory, "pre-push");
    mkdirSync(hooksDirectory);
    writeFileSync(configPath, `[core]\n\thooksPath = ${hooksDirectory}\n`);
    writeFileSync(existingHook, "#!/bin/sh\necho existing-policy\n");

    const result = Bun.spawnSync(["bun", "scripts/setup-hooks.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: configPath,
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain(
      "setup-hooks: refusing to install because core.hooksPath is configured",
    );
    expect(readFileSync(existingHook, "utf8")).toBe("#!/bin/sh\necho existing-policy\n");
  });
});
