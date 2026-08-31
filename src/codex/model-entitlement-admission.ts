import type { AdmissionLease } from "../lib/admission";
import type { OcxConfig } from "../types";
import { MAIN_CODEX_ACCOUNT_ID } from "./main-account";
import {
  resolveCodexModelEntitlements,
  type CodexModelEntitlementResolveOptions,
  type CodexModelEntitlementSnapshot,
} from "./model-entitlements";
import { tryAcquireNativeMainProfileClaim } from "./native-main-admission";
import { withNativeMainSharedClaim } from "./native-main-claim";
import { resolveNativeProfileContext } from "./native-profile-store";
import { NativeProfileError } from "./native-profile-types";

interface ModelEntitlementAdmissionDeps {
  readonly acquireNativeMain?: () => AdmissionLease | null;
  readonly resolve?: typeof resolveCodexModelEntitlements;
  readonly withSharedClaim?: <T>(operation: () => Promise<T>) => Promise<T>;
}

function excludeNativeMain(
  options: CodexModelEntitlementResolveOptions,
): CodexModelEntitlementResolveOptions {
  return {
    ...options,
    excludeAccountIds: new Set([
      ...(options.excludeAccountIds ?? []),
      MAIN_CODEX_ACCOUNT_ID,
    ]),
  };
}

/**
 * Resolve background/data-plane entitlements inside both native-main fences.
 *
 * Pool discovery remains available when startup recovery or a profile drain
 * owns the physical credential. When main is admitted, the process-local lease
 * and cross-process shared claim cover its complete read/possible refresh.
 */
export async function resolveAdmittedCodexModelEntitlements(
  config: Pick<OcxConfig, "codexAccounts">,
  options: CodexModelEntitlementResolveOptions = {},
  deps: ModelEntitlementAdmissionDeps = {},
): Promise<CodexModelEntitlementSnapshot> {
  const resolve = deps.resolve ?? resolveCodexModelEntitlements;
  const lease = (deps.acquireNativeMain ?? tryAcquireNativeMainProfileClaim)();
  if (!lease) return resolve(config, excludeNativeMain(options));

  try {
    const operation = () => resolve(config, options);
    const withSharedClaim = deps.withSharedClaim
      ?? (<T>(work: () => Promise<T>) => withNativeMainSharedClaim(resolveNativeProfileContext(), work));
    try {
      return await withSharedClaim(operation);
    } catch (error) {
      // A foreign exclusive holder or an unsupported claim filesystem makes
      // main unavailable; it must not suppress independent Pool discovery.
      if (!(error instanceof NativeProfileError)) throw error;
      return await resolve(config, excludeNativeMain(options));
    }
  } finally {
    lease.release();
  }
}
