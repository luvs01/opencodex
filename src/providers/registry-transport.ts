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
 * its configured destination, and its configured adapter, auth mode, and normalized endpoint
 * must literally equal one of the entry's declared destinations: its fixed transport, a
 * documented `baseUrlChoices` endpoint, or a `destinationAliases` former endpoint that still
 * answers for the row. An exact id is canonicalized instead: routing overwrites the adapter
 * and derives the auth mode, and an `allowBaseUrlOverride` preset keeps only its configured
 * URL, so ownership there is proven by the endpoint alone. A `preserveCustomDestination`
 * preset's stored row is not canonicalized, so it again needs a literal match. Reusing the
 * owner's pinning rule or an arbitrary URL would apply vendor verdicts to destinations
 * routing still serves as custom.
 */
export function providerMatchesRegistryTransportOrAlias(
  name: string,
  provider: Pick<OcxProviderConfig, "baseUrl" | "adapter"> & Partial<Pick<OcxProviderConfig, "authMode">>,
): boolean {
  const exact = getProviderRegistryEntry(name);
  if (exact !== undefined) {
    // Routing discards the configured URL for a pinned name, so its mismatch under the
    // pinned rule cannot move the wire.
    if (exact.allowBaseUrlOverride !== true && exact.preserveCustomDestination !== true) {
      return providerMatchesRegistryTransport(name, provider);
    }
    // A stored row on a preserved preset is not canonicalized — the configured adapter,
    // auth mode, and endpoint all reach the wire, so each must equal a declared destination.
    if (exact.preserveCustomDestination === true) {
      return configuredTransportMatchesDeclaredDestinations(exact, provider);
    }
    // Routing canonicalizes the adapter to `entry.adapter` and derives the auth mode for a
    // transport-matched row, preserving only the configured URL on an overridable preset;
    // the destination the wire reaches is therefore the entry's own whenever the configured
    // endpoint is one the entry declares.
    return configuredEndpointIsDeclaredDestination(exact, provider);
  }
  const lower = name.toLowerCase();
  const owner = PROVIDER_REGISTRY.find(row =>
    row.id.toLowerCase() === lower
    || (row.extraMetadataAliases ?? []).some(alias => alias.toLowerCase() === lower));
  return owner !== undefined && configuredTransportMatchesDeclaredDestinations(owner, provider);
}

/**
 * The destinations a registry row declares as its own: its fixed transport (skipped when
 * the URL is a template, which no saved row can equal), documented `baseUrlChoices`
 * endpoints (a "custom" choice declares no URL and cannot match), and `destinationAliases`
 * former endpoints on their own adapters.
 */
function declaredDestinations(entry: ProviderRegistryEntry): { adapter: string; baseUrl: string }[] {
  const declared = [
    ...(entry.destinationAliases ?? []),
    ...(entry.baseUrlChoices ?? []).flatMap(choice =>
      choice.baseUrl === undefined ? [] : [{ adapter: entry.adapter, baseUrl: choice.baseUrl }]),
  ];
  if (!/\{[^}]*\}/.test(entry.baseUrl)) {
    declared.push({ adapter: entry.adapter, baseUrl: entry.baseUrl });
  }
  return declared;
}

/**
 * Whether a row's configured transport literally equals one of `entry`'s declared
 * destinations on the destination's own adapter. Used for names routing does not pin and
 * for preserved presets whose stored row is the wire: the destination the request actually
 * reaches must be one the registry row owns for generated vendor verdicts to apply.
 */
function configuredTransportMatchesDeclaredDestinations(
  entry: ProviderRegistryEntry,
  provider: Pick<OcxProviderConfig, "baseUrl" | "adapter"> & Partial<Pick<OcxProviderConfig, "authMode">>,
): boolean {
  if (typeof provider.baseUrl !== "string") return false;
  // An unset authMode is the legacy key default, so it can only satisfy a key-auth owner.
  if ((provider.authMode ?? "key") !== entry.authKind) return false;
  const endpoint = normalizedProviderEndpoint(provider.baseUrl);
  return declaredDestinations(entry).some(target =>
    target.adapter === provider.adapter && normalizedProviderEndpoint(target.baseUrl) === endpoint);
}

/**
 * Whether a row's configured endpoint is one of `entry`'s declared destinations. Used for
 * transport-matched exact ids on overridable presets: routing overwrites the adapter with
 * `entry.adapter` and derives the auth mode, so only the URL distinguishes a canonicalized
 * row from a retargeted one.
 */
function configuredEndpointIsDeclaredDestination(
  entry: ProviderRegistryEntry,
  provider: Pick<OcxProviderConfig, "baseUrl" | "adapter"> & Partial<Pick<OcxProviderConfig, "authMode">>,
): boolean {
  if (typeof provider.baseUrl !== "string") return false;
  const endpoint = normalizedProviderEndpoint(provider.baseUrl);
  return declaredDestinations(entry).some(target =>
    normalizedProviderEndpoint(target.baseUrl) === endpoint);
}
