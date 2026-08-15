import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectServiceManagerInstallation,
  type ProbeRunner,
} from "../src/service-manager-probe";

test("Linux reports systemd absent when systemctl cannot be spawned", () => {
  const home = mkdtempSync(join(tmpdir(), "ocx-probe-docker-"));
  const run: ProbeRunner = () => ({
    status: null,
    stdout: "",
    stderr: "spawn systemctl ENOENT",
    timedOut: false,
    spawnFailed: true,
    spawnErrorCode: "ENOENT",
  });

  try {
    expect(inspectServiceManagerInstallation({ run, platform: "linux", home })).toEqual({
      kind: "absent",
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test.each([
  ["ETIMEDOUT", true],
  ["EACCES", false],
] as const)("Linux does not treat a %s systemctl failure as absent", (spawnErrorCode, timedOut) => {
  const home = mkdtempSync(join(tmpdir(), "ocx-probe-failure-"));
  const run: ProbeRunner = () => ({
    status: null,
    stdout: "",
    stderr: `spawn systemctl ${spawnErrorCode}`,
    timedOut,
    spawnFailed: !timedOut,
    spawnErrorCode,
  });

  try {
    expect(inspectServiceManagerInstallation({ run, platform: "linux", home }).kind).toBe("unknown");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
