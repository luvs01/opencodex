import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Keep read-only pnpm probes away from the caller's project and its executable hooks. */
export const PNPM_READ_CWD = dirname(fileURLToPath(import.meta.url));

const PNPM_MUTATION_COMMANDS = new Set(["add", "install", "update", "remove", "uninstall"]);

/**
 * Mutations (`add -g`, rollback) cannot run from inside the installed package: on Windows
 * a child whose working directory sits in the tree being replaced pins it open and blocks
 * removal. A stable directory outside the package keeps that handle neutral.
 */
export const PNPM_MUTATION_CWD = tmpdir();

/** Working directory for a pnpm child: read probes isolate, mutations stay outside the package. */
export function pnpmCommandCwd(args) {
  return PNPM_MUTATION_COMMANDS.has(args?.[0]) ? PNPM_MUTATION_CWD : PNPM_READ_CWD;
}

export function pnpmReadEnvironment(env = process.env) {
  const isolated = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_ignore_pnpmfile"),
  );
  return { ...isolated, npm_config_ignore_pnpmfile: "true" };
}
