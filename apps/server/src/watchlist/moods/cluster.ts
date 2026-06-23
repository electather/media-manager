import type { ConsolaInstance } from "consola";
import {
  MIN_CLUSTER_SIZE,
  MOOD_IDS,
  keyToId,
  type MoodId,
  type MoodSummaryCluster,
  type WatchlistMoodSummary,
} from "@nama/shared/watchlist";
import type { CatalogService } from "../../catalog";
import { batchLoad, listAllActiveRows, type MediaService } from "../../media";
import { MemoryCache } from "../../cache/memory";
import { derive } from "./derive";

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 5000;

const cache = new MemoryCache(CACHE_MAX_ENTRIES);

function summaryCacheKey(userId: string): string {
  return `watchlist:moods:${userId}`;
}

export interface MoodSummaryContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  deadlineMs?: number;
  log: ConsolaInstance;
}

/** Aggregate mood tally across active rows, cached 30s. Clusters < MIN_CLUSTER_SIZE omitted. Uses media.batchLoad (design §G) not local getMetadataBatch. */
// fallow-ignore-next-line complexity
export async function getSummary(ctx: MoodSummaryContext): Promise<WatchlistMoodSummary> {
  const key = summaryCacheKey(ctx.userId);
  const hit = await cache.get<WatchlistMoodSummary>(key);
  if (hit !== null) return hit;

  const rows = await listAllActiveRows(ctx.userId);
  if (rows.length === 0) {
    const empty: WatchlistMoodSummary = { clusters: [] };
    await cache.set(key, empty, CACHE_TTL_MS);
    return empty;
  }

  const { metadata } = await batchLoad(rows, ctx);

  const tally = new Map<MoodId, number>();
  for (const row of rows) {
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const tags = derive(metadata[composite]);
    for (const tag of tags) tally.set(tag, (tally.get(tag) ?? 0) + 1);
  }

  // fallow-ignore-next-line code-duplication
  const clusters: MoodSummaryCluster[] = MOOD_IDS.map((id) => ({
    moodId: id,
    count: tally.get(id) ?? 0,
  })).filter((c) => c.count >= MIN_CLUSTER_SIZE);

  // fallow-ignore-next-line code-duplication
  const summary: WatchlistMoodSummary = { clusters };
  await cache.set(key, summary, CACHE_TTL_MS);
  return summary;
}

export async function invalidateMoodSummary(userId: string): Promise<void> {
  await cache.delete(summaryCacheKey(userId));
}

/** Test-only. */
export async function __resetMoodCache(): Promise<void> {
  await cache.clear("watchlist:moods:");
}
