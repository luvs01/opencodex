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
 * its configured destination. The owner's generated verdict is then authoritative only while
 * the configured adapter, auth mode, and normalized endpoint literally equal that entry's
 * declared transport; reusing the owner's pinning rule would apply vendor verdicts to
 * destinations routing still serves as custom.
 */
export function providerMatchesRegistryTransportOrAlias(
  name: string,
  provider: Pick<OcxProviderConfig, "baseUrl" | "adapter"> & Partial<Pick<OcxProviderConfig, "authMode">>,
): boolean {
  const exact = getProviderRegistryEntry(name);
  if (exact !== undefined) return providerMatchesRegistryTransport(name, provider);
  const lower = name.toLowerCase();
  const owner = PROVIDER_REGISTRY.find(row =>
    row.id.toLowerCase() === lower
    || (row.extraMetadataAliases ?? []).some(alias => alias.toLowerCase() === lower));
  return owner !== undefined && configuredTransportMatchesRegistryEntry(owner, provider);
}

/**
 * Whether a row's configured transport literally equals the declared transport of `entry`.
 * Used for names routing does not pin (metadata aliases, case-varied ids): the destination
 * the wire actually reaches must be the registry row's own adapter/auth/endpoint.
 */
function configuredTransportMatchesRegistryEntry(
  entry: ProviderRegistryEntry,
  provider: Pick<OcxProviderConfig, "baseUrl" | "adapter"> & Partial<Pick<OcxProviderConfig, "authMode">>,
): boolean {
  if (/\{[^}]*\}/.test(entry.baseUrl)) return false;
  if (typeof provider.baseUrl !== "string") return false;
  if (provider.adapter !== entry.adapter) return false;
  // An unset authMode is the legacy key default, so it can only satisfy a key-auth owner.
  if ((provider.authMode ?? "key") !== entry.authKind) return false;
  return normalizedProviderEndpoint(provider.baseUrl) === normalizedProviderEndpoint(entry.baseUrl);
}
