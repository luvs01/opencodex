import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";

/**
 * How to launch the dashboard update worker on POSIX.
 *
 * A worker spawned from the systemd user service stays in that service's cgroup even when
 * detached, and the generated unit keeps the default `KillMode=control-group`. The updater then
 * stops `opencodex-proxy.service` and systemd kills the worker with it, leaving the proxy offline
 * on the old package (#5750). `systemd-run --user --scope` moves the worker into its own
 * transient scope first; `--scope` execs the command in place, so the returned PID is still the
 * worker's. Outside a systemd-started process (`INVOCATION_ID` unset), or when `systemd-run` is
 * missing, the plain detached spawn is unchanged.
 */
export const SYSTEMD_SCOPE_ARGS = ["--user", "--scope", "--quiet", "--collect", "--"] as const;

export interface WorkerLaunchContext {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resolveSystemdRun?: () => string | undefined;
}

// Absolute install paths only — PATH is never consulted, so a caller-controlled entry cannot
// redirect the launch. `/usr/local/bin` is where systemd lands when built or stowed outside the
// distro layout, and `/run/current-system/sw/bin` is the NixOS layout, where the binary lives
// nowhere else even though the user bus works.
const TRUSTED_SYSTEMD_RUN_PATHS = [
  "/usr/bin/systemd-run", "/bin/systemd-run", "/usr/local/bin/systemd-run",
  "/run/current-system/sw/bin/systemd-run",
] as const;

export interface SystemdRunHooks {
  isExecutableFile: (path: string) => boolean;
  probeScope: (path: string) => boolean;
}

const systemdRunHooks: SystemdRunHooks = {
  isExecutableFile: path => {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  // Run a real no-op scope rather than `--version`: a present binary without a reachable user
  // bus would otherwise pass the probe and then fail to start the worker at all.
  probeScope: path => {
    const probe = spawnSync(path, [...SYSTEMD_SCOPE_ARGS, "true"], { stdio: "ignore", timeout: 5_000 });
    return !probe.error && probe.status === 0;
  },
};

let systemdRunProbe: string | null | undefined;

export function resolveSystemdRun(hooks: SystemdRunHooks = systemdRunHooks): string | undefined {
  if (systemdRunProbe === undefined) {
    systemdRunProbe = null;
    for (const command of TRUSTED_SYSTEMD_RUN_PATHS) {
      if (!hooks.isExecutableFile(command)) continue;
      if (hooks.probeScope(command)) {
        systemdRunProbe = command;
        break;
      }
    }
  }
  return systemdRunProbe ?? undefined;
}

export function resetSystemdRunProbeForTests(): void {
  systemdRunProbe = undefined;
}

export function guiUpdateWorkerCommand(
  execPath: string,
  args: readonly string[],
  context: WorkerLaunchContext = {},
): { command: string; argv: string[] } {
  const platform = context.platform ?? process.platform;
  const env = context.env ?? process.env;
  const underSystemd = platform === "linux" && Boolean(env.INVOCATION_ID);
  const systemdRun = underSystemd ? (context.resolveSystemdRun ?? resolveSystemdRun)() : undefined;
  if (systemdRun) {
    return { command: systemdRun, argv: [...SYSTEMD_SCOPE_ARGS, execPath, ...args] };
  }
  return { command: execPath, argv: [...args] };
}
