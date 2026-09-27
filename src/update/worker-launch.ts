import { spawn } from "node:child_process";
import { accessSync, constants, realpathSync, statSync, type Stats } from "node:fs";
import { dirname, isAbsolute } from "node:path";

/** A separate user scope survives stopping the proxy service's control-group. */
export const SYSTEMD_SCOPE_ARGS = ["--user", "--scope", "--quiet", "--collect", "--"] as const;
export interface WorkerLaunchContext {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resolveSystemdRun?: () => string | undefined;
}
const TRUSTED_SYSTEMD_RUN_PATHS = [
  "/usr/bin/systemd-run", "/bin/systemd-run", "/usr/local/bin/systemd-run",
  "/run/current-system/sw/bin/systemd-run",
] as const;
export interface SystemdRunHooks {
  isExecutableFile: (path: string) => boolean;
  probeScope: (path: string) => boolean | Promise<boolean>;
}
type TrustStat = Pick<Stats, "uid" | "mode" | "isFile" | "isDirectory">;
export interface SystemdRunFileIO {
  access: (path: string) => void;
  realpath: (path: string) => string;
  stat: (path: string) => TrustStat;
}
const trustIO: SystemdRunFileIO = {
  access: path => accessSync(path, constants.X_OK),
  realpath: path => realpathSync(path),
  stat: path => statSync(path),
};
const rootOnlyWritable = (st: TrustStat): boolean => st.uid === 0 && (st.mode & 0o022) === 0;

/** Validate both named and resolved namespaces, not just the leaf's immediate parent. */
export function isTrustedSystemdRunFile(path: string, io: SystemdRunFileIO = trustIO): boolean {
  try {
    if (!isAbsolute(path)) return false;
    io.access(path);
    const target = io.realpath(path);
    if (!isAbsolute(target)) return false;
    const file = io.stat(target);
    if (!file.isFile() || !rootOnlyWritable(file)) return false;
    for (const initial of [dirname(path), dirname(target)]) {
      let current = initial;
      while (true) {
        const directory = io.stat(current);
        if (!directory.isDirectory() || !rootOnlyWritable(directory)) return false;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
    return true;
  } catch { return false; }
}

/** A bounded asynchronous scope probe; no shell, PATH-resolved payload or secret env. */
function probeScope(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    for (const name of ["HOME", "USER", "LOGNAME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    // Execute this same trusted binary's harmless version command inside the scope.
    const child = spawn(path, [...SYSTEMD_SCOPE_ARGS, path, "--version"], { stdio: "ignore", env });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* failed termination is not success */ }
      child.unref();
      finish(false);
    }, 5_000);
    child.once("error", () => finish(false));
    child.once("exit", code => finish(code === 0));
  });
}
const systemdRunHooks: SystemdRunHooks = { isExecutableFile: isTrustedSystemdRunFile, probeScope };
let cached: string | null | undefined;
let pending: Promise<string | undefined> | undefined;
let generation = 0;

/** Share in-flight discovery; each failed candidate yields to the event loop. */
export function resolveSystemdRun(hooks: SystemdRunHooks = systemdRunHooks): Promise<string | undefined> {
  if (cached !== undefined) return Promise.resolve(cached ?? undefined);
  if (pending) return pending;
  const epoch = generation;
  pending = (async () => {
    for (const command of TRUSTED_SYSTEMD_RUN_PATHS) {
      try {
        if (hooks.isExecutableFile(command) && await hooks.probeScope(command)) return command;
      } catch { /* unavailable candidates never grant launch authority */ }
    }
    return undefined;
  })().then(command => {
    if (epoch === generation) { cached = command ?? null; pending = undefined; }
    return command;
  });
  return pending;
}

/** The async management path prepares discovery before its synchronous job reservation. */
export async function prepareGuiUpdateWorkerLaunch(
  context: Pick<WorkerLaunchContext, "platform" | "env"> = {},
): Promise<void> {
  if ((context.platform ?? process.platform) === "linux" && (context.env ?? process.env).INVOCATION_ID) {
    await resolveSystemdRun();
  }
}
export function resetSystemdRunProbeForTests(): void { generation++; cached = undefined; pending = undefined; }

/** Render only; never block a request by spawning a discovery subprocess here. */
export function guiUpdateWorkerCommand(
  execPath: string,
  args: readonly string[],
  context: WorkerLaunchContext = {},
): { command: string; argv: string[] } {
  const underSystemd = (context.platform ?? process.platform) === "linux" && Boolean((context.env ?? process.env).INVOCATION_ID);
  const resolveCached = () => cached && isTrustedSystemdRunFile(cached) ? cached : undefined;
  const systemdRun = underSystemd ? (context.resolveSystemdRun ?? resolveCached)() : undefined;
  return systemdRun ? { command: systemdRun, argv: [...SYSTEMD_SCOPE_ARGS, execPath, ...args] }
    : { command: execPath, argv: [...args] };
}
