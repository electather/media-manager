import { cacheKey, getCacheProvider, ttlMsFor } from "./cache";
import type { CapabilityDefinition, ResolvedCapabilityScope } from "@ent-mcp/plugin-sdk";
import type { DispatchRequest } from "./types";

export function cacheKeyFor(req: DispatchRequest, scope: ResolvedCapabilityScope): Promise<string> {
  return cacheKey({
    capability: req.capability,
    version: req.version,
    method: req.method,
    userId: req.userId,
    scope,
    input: req.input,
  });
}

export async function readCache<T>(
  req: DispatchRequest,
  scope: ResolvedCapabilityScope,
): Promise<T | undefined> {
  if (req.skipCache) return undefined;
  const key = await cacheKeyFor(req, scope);
  // Values are wrapped in { v } so a negatively-cached `null` is distinguishable
  // from a cache miss (both would otherwise serialize to `null`).
  const cached = await getCacheProvider().get<{ v: T }>(key);
  if (cached === null) return undefined;
  return cached.v;
}

export async function writeCache<T>(
  req: DispatchRequest,
  capability: CapabilityDefinition,
  scope: ResolvedCapabilityScope,
  value: T,
): Promise<void> {
  if (req.skipCache) return;
  const key = await cacheKeyFor(req, scope);
  const ttl = ttlMsFor(capability, value);
  await getCacheProvider().set(key, { v: value }, ttl);
}

export async function applyInvalidations(
  req: DispatchRequest,
  capability: CapabilityDefinition,
): Promise<void> {
  const methodSpec = capability.methods[req.method];
  if (!methodSpec?.invalidates?.length) return;
  const provider = getCacheProvider();
  for (const key of methodSpec.invalidates) {
    const [capId, version] = key.split("@");
    if (!capId || !version) continue;
    await provider.clear(`mv:${capId}:${version}:`);
  }
}

/**
 * Clears every `mv:` cache entry. Called on connection create/update/delete/
 * enable/disable since most scoped keys depend on the active connection set.
 * The memory cache does not support non-prefix matching, so a broad sweep is
 * simpler and correctness-preserving. Redis could later scan by user prefix.
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  await getCacheProvider().clear(`mv:`);
  void userId;
}
