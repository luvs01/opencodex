import { describe, expect, test } from "bun:test";

import { MAIN_CODEX_ACCOUNT_ID } from "../src/codex/main-account";
import { resolveAdmittedCodexModelEntitlements } from "../src/codex/model-entitlement-admission";
import type { CodexModelEntitlementResolveOptions } from "../src/codex/model-entitlements";
import { NativeProfileError } from "../src/codex/native-profile-types";

const emptySnapshot = {
  modelsByAccount: new Map<string, ReadonlySet<string>>(),
  confirmedAccountIds: new Set<string>(),
  credentialIdentities: new Map<string, string>(),
};

describe("Codex model entitlement admission", () => {
  test("excludes native main before credential discovery when lifecycle admission is blocked", async () => {
    let received: CodexModelEntitlementResolveOptions | undefined;

    await resolveAdmittedCodexModelEntitlements({ codexAccounts: [] }, {}, {
      acquireNativeMain: () => null,
      resolve: async (_config, options) => {
        received = options;
        return emptySnapshot;
      },
    });

    expect(received?.excludeAccountIds?.has(MAIN_CODEX_ACCOUNT_ID)).toBe(true);
  });

  test("holds lifecycle and shared claims through credential discovery", async () => {
    const events: string[] = [];
    let released = false;

    await resolveAdmittedCodexModelEntitlements({ codexAccounts: [] }, {}, {
      acquireNativeMain: () => ({ release: () => {
        released = true;
        events.push("lifecycle-release");
      } }),
      withSharedClaim: async operation => {
        events.push("shared-enter");
        const result = await operation();
        events.push("shared-release");
        return result;
      },
      resolve: async () => {
        expect(released).toBe(false);
        events.push("credential-discovery");
        return emptySnapshot;
      },
    });

    expect(events).toEqual([
      "shared-enter",
      "credential-discovery",
      "shared-release",
      "lifecycle-release",
    ]);
  });

  test("falls back to Pool-only discovery when the shared claim is unavailable", async () => {
    const exclusions: boolean[] = [];

    await resolveAdmittedCodexModelEntitlements({ codexAccounts: [] }, {}, {
      acquireNativeMain: () => ({ release: () => undefined }),
      withSharedClaim: async () => {
        throw new NativeProfileError("NATIVE_MAIN_CLAIM_BUSY", "busy", 503, true);
      },
      resolve: async (_config, options) => {
        exclusions.push(options.excludeAccountIds?.has(MAIN_CODEX_ACCOUNT_ID) === true);
        return emptySnapshot;
      },
    });

    expect(exclusions).toEqual([true]);
  });
});
