import type { LibraryFacetCounts } from "@nama/shared/library";
import { MemoryCache } from "../../cache/memory";

/**
 * Short-TTL per-user cache for the unfiltered facet totals (design §Facets:
 * "cache short-TTL, invalidate on sync"). The facet query fans out a handful of
 * GROUP BYs, so the FE's repeated reads (the popover re-opens, the rail
 * re-renders) ride the cache instead of re-aggregating. It is a module-singleton
 * `MemoryCache` mirroring `watchlist/tonight/section.ts` rather than the media
 * dispatch cache, because the facets are a same-module concern with no
 * cross-process invalidation need: the membership sync busts the entry directly
 * (`bustFacets`), no event bus required.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5000;
const cache = new MemoryCache(CACHE_MAX_ENTRIES);

function facetsCacheKey(userId: string): string {
  return `library:facets:${userId}`;
}

/** Reads the cached facet totals for a user, or null on a miss/expiry. */
export async function readFacets(userId: string): Promise<LibraryFacetCounts | null> {
  return cache.get<LibraryFacetCounts>(facetsCacheKey(userId));
}

/** Caches a user's freshly computed facet totals for the short TTL. */
export async function writeFacets(userId: string, facets: LibraryFacetCounts): Promise<void> {
  await cache.set(facetsCacheKey(userId), facets, CACHE_TTL_MS);
}

/**
 * Invalidates a user's cached facet totals. Called by the membership sync after
 * it writes new owned rows / tombstones so the next `/facets` read recomputes
 * against the changed owned set rather than serving a stale snapshot.
 */
export async function bustFacets(userId: string): Promise<void> {
  await cache.delete(facetsCacheKey(userId));
}
