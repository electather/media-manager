import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import { keyToId, type WatchlistCounts } from "@ent-mcp/shared/watchlist";
import { MemoryCache } from "../../cache/memory";
import {
  classifyBucket,
  getMatchingServersCached,
  listAllActiveRows,
  previewForClassify,
  type MatchingServer,
} from "../../media";
import { asWatchlistContext, type MaybeRowContext } from "./context";

const COUNTS_CACHE_TTL_MS = 30_000;
const COUNTS_CACHE_MAX_ENTRIES = 5000;
const countsCache = new MemoryCache(COUNTS_CACHE_MAX_ENTRIES);

function countsCacheKey(userId: string): string {
  return `watchlist:counts:${userId}`;
}

/**
 * Returns cheap aggregate counts for the header pips. Walks every active row
 * once with metadata, status, and cached matching-server probes, but skips
 * artwork dispatch and catalog cold-fill.
 */
// fallow-ignore-next-line complexity
export async function getCounts(ctx: MaybeRowContext): Promise<WatchlistCounts> {
  const c = asWatchlistContext(ctx);
  const cacheKey = countsCacheKey(c.userId);
  const hit = await countsCache.get<WatchlistCounts>(cacheKey);
  if (hit !== null) return hit;

  const rows = await listAllActiveRows(c.userId);
  if (rows.length === 0) {
    const empty: WatchlistCounts = {
      ready: 0,
      inProgress: 0,
      awaiting: 0,
      unavailable: 0,
      upcoming: 0,
      total: 0,
    };
    await countsCache.set(cacheKey, empty, COUNTS_CACHE_TTL_MS);
    return empty;
  }

  const compositeIds = rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType }));
  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));

  const [statuses, metadata, progress] = await Promise.all([
    // fallow-ignore-next-line code-duplication
    c.mediaService.getStatusBatch(compositeIds).catch((err) => {
      c.log.warn("[watchlist:counts] getStatusBatch failed", err);
      return {} as Record<string, string>;
    }),
    c.catalog.getMetadataBatch(metadataKeys).catch((err) => {
      c.log.warn("[watchlist:counts] getMetadataBatch failed", err);
      return {} as Record<string, CanonicalMetadata>;
    }),
    c.loadProgressMap(c),
  ]);

  const serverProbes = await Promise.allSettled(
    rows.map((row) =>
      getMatchingServersCached(c.userId, c.mediaService, row.tmdbId, row.mediaType),
    ),
  );

  let ready = 0;
  let inProgress = 0;
  let awaiting = 0;
  let unavailable = 0;
  let upcoming = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const probe = serverProbes[i]!;
    const servers: MatchingServer[] = probe.status === "fulfilled" ? probe.value : [];
    const preview = previewForClassify(
      metadata[composite],
      statuses[composite],
      servers,
      progress.map.get(composite),
    );
    const bucket = classifyBucket(preview);
    if (bucket === "ready") ready++;
    else if (bucket === "in-progress") inProgress++;
    else if (bucket === "awaiting") awaiting++;
    else if (bucket === "upcoming") upcoming++;
    else if (bucket === "unavailable") unavailable++;
  }

  const counts: WatchlistCounts = {
    ready,
    inProgress,
    awaiting,
    unavailable,
    upcoming,
    total: rows.length,
  };
  await countsCache.set(cacheKey, counts, COUNTS_CACHE_TTL_MS);
  return counts;
}

export async function invalidateCounts(userId: string): Promise<void> {
  await countsCache.delete(countsCacheKey(userId));
}

/** Test-only. */
export async function __resetCountsCache(): Promise<void> {
  await countsCache.clear("watchlist:counts:");
}
