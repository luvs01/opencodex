export declare const PNPM_READ_CWD: string;

export declare const PNPM_MUTATION_CWD: string;

export declare function pnpmCommandCwd(args?: readonly string[]): string;

export declare function pnpmReadEnvironment(
  env?: Record<string, string | undefined>,
): Record<string, string | undefined>;
