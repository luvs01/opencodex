import type { TKey } from "./en";

export type Vars = Record<string, string | number>;
export type TFn = (key: TKey, vars?: Vars) => string;

export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  let out = s;
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}
