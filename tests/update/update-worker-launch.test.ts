import { describe, expect, test } from "bun:test";
import {
  guiUpdateWorkerCommand, resolveSystemdRun, resetSystemdRunProbeForTests, SYSTEMD_SCOPE_ARGS,
} from "../../src/update/worker-launch";

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

// The real resolver — not the context seam — must be the thing under test: PATH must stay
// unconsulted, only the trusted absolute candidates may be probed, and a failed probe must
// fall through rather than settle for the plain in-cgroup spawn.
describe("trusted systemd-run discovery", () => {
  test("walks only the trusted candidates and ignores PATH", () => {
    resetSystemdRunProbeForTests();
    const seen: string[] = [];
    const found = resolveSystemdRun({
      isExecutableFile: path => { seen.push(path); return path === "/run/current-system/sw/bin/systemd-run"; },
      probeScope: () => true,
    });
    expect(found).toBe("/run/current-system/sw/bin/systemd-run");
    expect(seen).toEqual(["/usr/bin/systemd-run", "/bin/systemd-run", "/run/current-system/sw/bin/systemd-run"]);
    expect(seen.every(path => path.startsWith("/"))).toBe(true);
  });

  test("a failed scope probe falls through to the next candidate", () => {
    resetSystemdRunProbeForTests();
    const found = resolveSystemdRun({
      isExecutableFile: () => true,
      probeScope: path => path !== "/usr/bin/systemd-run",
    });
    expect(found).toBe("/bin/systemd-run");
  });

  test("the probe is cached and reports undefined when nothing qualifies", () => {
    resetSystemdRunProbeForTests();
    let calls = 0;
    const hooks = {
      isExecutableFile: () => { calls++; return false; },
      probeScope: () => { throw new Error("must not run"); },
    };
    expect(resolveSystemdRun(hooks)).toBeUndefined();
    expect(resolveSystemdRun(hooks)).toBeUndefined();
    expect(calls).toBe(3);
    resetSystemdRunProbeForTests();
  });
});
