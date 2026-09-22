import type { OcxProviderConfig } from "../types";
import {
  PROVIDER_REGISTRY,
  getProviderRegistryEntry,
  normalizedProviderEndpoint,
  providerMatchesRegistryTransport,
} from "./registry";
import type { ProviderRegistryEntry } from "./registry/types";

/**
 * `providerMatchesRegistryTransport` for a configured name that may be a generated-metadata
 * ALIAS rather than a registry id.
 *
 * A registry row claims extra names through `extraMetadataAliases` (`gemini` for `google`,
 * `anthropic-key` for `anthropic-apikey`, ...), and `resolveMetadataProvider` resolves those
 * names — case-folded, the way saved provider keys arrive — to the row's metadata bundle. A
 * provider saved under an alias is owned by the declaring entry, so its transport must be
 * validated against that entry; an id-only lookup finds no `gemini` row and would drop a
 * verdict the registry still owns.
 *
 * Routing binds a name to a registry transport by exact id only — `routedProviderConfig` does
 * a case-sensitive `entry.id === providerName` lookup — so an alias- or case-named row keeps
 * its configured destination. An `allowBaseUrlOverride` preset keeps its override, and a
 * `preserveCustomDestination` preset keeps a stored row it cannot canonicalize, so for those
 * names the configured URL is again the wire destination. The owner's generated verdict is
 * then authoritative only while the configured adapter, auth mode, and normalized endpoint
 * literally equal one of the entry's declared destinations: its fixed transport, a
 * documented `baseUrlChoices` endpoint, or a `destinationAliases` former endpoint that still
 * answers for the row. Reusing the owner's pinning rule would apply vendor verdicts to
 * destinations routing still serves as custom.
 */
export function providerMatchesRegistryTransportOrAlias(
  name: string,
  provider: Pick<OcxProviderConfig, "baseUrl" | "adapter"> & Partial<Pick<OcxProviderConfig, "authMode">>,
): boolean {
  const exact = getProviderRegistryEntry(name);
  if (exact !== undefined) {
    // Routing discards the configured URL for a pinned name, so its mismatch under the
    // pinned rule cannot move the wire. A preset whose URL routing honors
    // (`allowBaseUrlOverride`) or whose stored row survives uncanonicalized
    // (`preserveCustomDestination`) reaches the configured URL instead — the pinned rule's
    // unconditional true no longer proves ownership there, so the destination must be one
    // of the entry's declared endpoints directly.
    if (exact.allowBaseUrlOverride === true || exact.preserveCustomDestination === true) {
      return configuredTransportMatchesDeclaredDestinations(exact, provider);
    }
    return providerMatchesRegistryTransport(name, provider);
  }
  const lower = name.toLowerCase();
  const owner = PROVIDER_REGISTRY.find(row =>
    row.id.toLowerCase() === lower
    || (row.extraMetadataAliases ?? []).some(alias => alias.toLowerCase() === lower));
  return owner !== undefined && configuredTransportMatchesDeclaredDestinations(owner, provider);
}

/**
 * Whether a row's configured transport literally equals one of `entry`'s declared
 * destinations — the fixed transport, a documented `baseUrlChoices` endpoint (a "custom"
 * choice declares no URL and cannot match), or a `destinationAliases` former endpoint —
 * on the destination's own adapter. Used for names routing does not pin and for presets
 * whose override or stored destination routing honors: the wire destination must be one
 * the registry row owns for generated vendor verdicts to apply.
 */
function configuredTransportMatchesDeclaredDestinations(
  entry: ProviderRegistryEntry,
  provider: Pick<OcxProviderConfig, "baseUrl" | "adapter"> & Partial<Pick<OcxProviderConfig, "authMode">>,
): boolean {
  if (typeof provider.baseUrl !== "string") return false;
  // An unset authMode is the legacy key default, so it can only satisfy a key-auth owner.
  if ((provider.authMode ?? "key") !== entry.authKind) return false;
  const endpoint = normalizedProviderEndpoint(provider.baseUrl);
  const declared = [
    ...(entry.destinationAliases ?? []),
    ...(entry.baseUrlChoices ?? []).flatMap(choice =>
      choice.baseUrl === undefined ? [] : [{ adapter: entry.adapter, baseUrl: choice.baseUrl }]),
  ];
  if (!/\{[^}]*\}/.test(entry.baseUrl)) {
    declared.push({ adapter: entry.adapter, baseUrl: entry.baseUrl });
  }
  return declared.some(target =>
    target.adapter === provider.adapter && normalizedProviderEndpoint(target.baseUrl) === endpoint);
}
