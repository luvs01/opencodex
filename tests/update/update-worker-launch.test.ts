import { describe, expect, test } from "bun:test";
import { guiUpdateWorkerCommand, SYSTEMD_SCOPE_ARGS } from "../../src/update/worker-launch";

// #5750: a worker spawned by the systemd user service must leave the service cgroup before the
// updater stops that service, or systemd kills it along with the proxy.
describe("dashboard update worker launch", () => {
  const args = ["/opt/ocx/src/cli/index.ts", "__gui-update-worker", "job-1", "stable", "restart"];

  test("a systemd-started Linux proxy launches the worker in its own scope", () => {
    const launch = guiUpdateWorkerCommand("/usr/bin/bun", args, {
      platform: "linux", env: { INVOCATION_ID: "abc", PATH: "/tmp/attacker:/usr/bin" },
      resolveSystemdRun: () => "/usr/bin/systemd-run",
    });
    expect(launch).toEqual({
      command: "/usr/bin/systemd-run", argv: [...SYSTEMD_SCOPE_ARGS, "/usr/bin/bun", ...args],
    });
  });

  test("without systemd-run, outside systemd, or off Linux the spawn is unchanged", () => {
    const plain = { command: "/usr/bin/bun", argv: args };
    expect(guiUpdateWorkerCommand("/usr/bin/bun", args, {
      platform: "linux", env: { INVOCATION_ID: "abc" }, resolveSystemdRun: () => undefined,
    })).toEqual(plain);
    let probed = false;
    expect(guiUpdateWorkerCommand("/usr/bin/bun", args, {
      platform: "linux", env: {}, resolveSystemdRun: () => { probed = true; return "/usr/bin/systemd-run"; },
    })).toEqual(plain);
    expect(probed).toBe(false);
    expect(guiUpdateWorkerCommand("/usr/bin/bun", args, {
      platform: "darwin", env: { INVOCATION_ID: "abc" }, resolveSystemdRun: () => "/usr/bin/systemd-run",
    })).toEqual(plain);
  });
});
