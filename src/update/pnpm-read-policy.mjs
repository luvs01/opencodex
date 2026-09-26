import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Keep read-only pnpm probes away from the caller's project and its executable hooks. */
export const PNPM_READ_CWD = dirname(fileURLToPath(import.meta.url));

export function pnpmReadEnvironment(env = process.env) {
  const isolated = Object.fromEntries(
    Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_ignore_pnpmfile"),
  );
  return { ...isolated, npm_config_ignore_pnpmfile: "true" };
}
