import { cacheKey, getCacheProvider, ttlMsFor } from "../service/cache";
import type { CapabilityDefinition, ResolvedCapabilityScope } from "@nama/plugin-sdk";
import type { DispatchRequest } from "../types";

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

// Matches the existing 1 * MIN negativeCacheTtlSec precedent used by
// watchHistory@v1, watchlist@v1, and ratings@v1 capabilities.
export const NEGATIVE_TTL_MS = 60 * 1000;

/**
 * Phase 7 catalog ownership: metadata/recommendations/watchHistory/ratings served from catalog first,
 * dispatcher runs only on catalog miss (cold-fill path). `mv:` cache retained to shield transient
 * plugin failures during catalog miss from upstream rate limits. Live-only capabilities unaffected.
 */

export async function writeCache<T>(
  req: DispatchRequest,
  capability: CapabilityDefinition,
  scope: ResolvedCapabilityScope,
  value: T,
  ttlOverrideMs?: number,
): Promise<void> {
  if (req.skipCache) return;
  const key = await cacheKeyFor(req, scope);
  const ttl = ttlOverrideMs ?? ttlMsFor(capability, value);
  await getCacheProvider().set(key, { v: value }, ttl);
}

// fallow-ignore-next-line complexity
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
 * Clears all `mv:` cache entries on connection change (create/update/delete/enable/disable).
 * `userId` accepted for symmetry but unused: memory cache only supports prefix clearing, and `mv:` keys
 * lack user namespacing today, so full sweep is required. Redis provider could later narrow to user prefix.
 */
export async function invalidateUserCache(_userId: string): Promise<void> {
  await getCacheProvider().clear(`mv:`);
}
