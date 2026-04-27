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

// Matches the existing 1 * MIN negativeCacheTtlSec precedent used by
// watchHistory@v1, watchlist@v1, and ratings@v1 capabilities.
export const NEGATIVE_TTL_MS = 60 * 1000;

/**
 * Catalog ownership notes (Phase 7 cleanup):
 *
 * - `metadata@v1.getDetails` / `metadata@v1.discover` are now served from
 *   `canonical_metadata` and `discover_snapshots` first; the dispatcher
 *   only runs them when the catalog returns nothing (cold-fill path).
 * - `recommendations@v1.getRecommendations` is served from
 *   `recommendation_lists` first; the dispatcher only runs it when the
 *   list is empty for that user.
 * - `watchHistory@v1.getHistory` / `ratings@v1.getRatings` are served
 *   from the per-user mirror first; the dispatcher only runs them when
 *   the mirror is empty (bootstrap window).
 *
 * The `mv:` cache layer is intentionally retained for those capabilities
 * even though catalog serves the warm path: it still covers the cold-fill
 * fallback so a transient plugin failure during catalog miss does not
 * fall through to the upstream rate limit. Live-only capabilities
 * (watchlist, idResolve, etc.) are unaffected — catalog never serves
 * them and the cache is the only short-circuit.
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
 *
 * `userId` is accepted for API symmetry but not used for scoping: the memory
 * cache provider supports only prefix-based clearing and `mv:` keys are not
 * namespaced by user in the key format today, so a full sweep is the only
 * correct option. A Redis-backed provider could later narrow to a user prefix.
 */
export async function invalidateUserCache(_userId: string): Promise<void> {
  await getCacheProvider().clear(`mv:`);
}
