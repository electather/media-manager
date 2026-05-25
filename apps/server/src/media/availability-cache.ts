import type { MatchingServer, MediaAvailabilityService } from "./types";

/**
 * Process-local 30 s TTL cache for `getMatchingServers` keyed by
 * `${userId}:${tmdbId}:${mediaType}`. Lets the paired `/watchlist` +
 * `/watchlist/counts` round-trip on a single page-load share one plugin
 * probe per row instead of doubling the fan-out. Per-`MediaService` instance
 * memoization in `media/` is request-scoped and so cannot bridge two HTTP
 * handlers; this module sits above that boundary on purpose.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 5000;

interface Entry {
  value: MatchingServer[];
  expiresAt: number;
}

const cache = new Map<string, Entry>();

function cacheKey(userId: string, tmdbId: string, mediaType: "movie" | "tv"): string {
  return `${userId}\u0000${tmdbId}\u0000${mediaType}`;
}

// fallow-ignore-next-line complexity
function gc(now: number): void {
  if (cache.size < MAX_ENTRIES) return;
  for (const [k, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(k);
  }
  // If every entry is still fresh the sweep doesn't free anything — fall
  // back to LRU-style eviction (Map iteration order is insertion order, so
  // the first key is the oldest) until the map is back under the ceiling.
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function getMatchingServersCached(
  userId: string,
  mediaService: MediaAvailabilityService,
  tmdbId: string,
  mediaType: "movie" | "tv",
): Promise<MatchingServer[]> {
  const key = cacheKey(userId, tmdbId, mediaType);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const value = await mediaService.getMatchingServers(tmdbId, mediaType);
  gc(now);
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

/** Test-only: drop all cached entries. */
export function __resetAvailabilityCache(): void {
  cache.clear();
}
