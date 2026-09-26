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

const TRUSTED_SYSTEMD_RUN_PATHS = ["/usr/bin/systemd-run", "/bin/systemd-run"] as const;
let systemdRunProbe: string | null | undefined;

function resolveSystemdRun(): string | undefined {
  if (systemdRunProbe === undefined) {
    systemdRunProbe = null;
    for (const command of TRUSTED_SYSTEMD_RUN_PATHS) {
      try {
        accessSync(command, constants.X_OK);
        if (!statSync(command).isFile()) continue;
      } catch {
        continue;
      }
      // Run a real no-op scope rather than `--version`: a present binary without a reachable user
      // bus would otherwise pass the probe and then fail to start the worker at all.
      const probe = spawnSync(command, [...SYSTEMD_SCOPE_ARGS, "true"], { stdio: "ignore", timeout: 5_000 });
      if (!probe.error && probe.status === 0) {
        systemdRunProbe = command;
        break;
      }
    }
  }
  return systemdRunProbe ?? undefined;
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
