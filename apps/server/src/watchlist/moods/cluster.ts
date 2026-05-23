import type { ConsolaInstance } from "consola";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import {
  MIN_CLUSTER_SIZE,
  MOOD_IDS,
  keyToId,
  type MoodId,
  type MoodSummaryCluster,
  type WatchlistMoodSummary,
} from "@ent-mcp/shared/watchlist";
import type { CatalogService } from "../../catalog";
import * as repo from "../repo";
import { UserTtlCache } from "../user-cache";
import { derive } from "./derive";

const CACHE_TTL_MS = 30_000;

const cache = new UserTtlCache<WatchlistMoodSummary>(CACHE_TTL_MS);

export interface MoodSummaryContext {
  userId: string;
  catalog: CatalogService;
  log: ConsolaInstance;
}

/**
 * Aggregate mood tally across the user's active rows. Cached 30 s per user;
 * invalidated by the watchlist mutation listener. Clusters below
 * `MIN_CLUSTER_SIZE` are omitted from the summary so the client doesn't show
 * a one-item "Mood" chip.
 */
export async function getSummary(ctx: MoodSummaryContext): Promise<WatchlistMoodSummary> {
  const hit = cache.get(ctx.userId);
  if (hit) return hit;

  const rows = await repo.listAllActive(ctx.userId);
  if (rows.length === 0) {
    const empty: WatchlistMoodSummary = { clusters: [] };
    cache.set(ctx.userId, empty);
    return empty;
  }

  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));
  const metadata = await ctx.catalog.getMetadataBatch(metadataKeys).catch((err) => {
    ctx.log.warn("[watchlist:moods] getMetadataBatch failed", err);
    return {} as Record<string, CanonicalMetadata>;
  });

  const tally = new Map<MoodId, number>();
  for (const row of rows) {
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const tags = derive(metadata[composite]);
    for (const tag of tags) tally.set(tag, (tally.get(tag) ?? 0) + 1);
  }

  const clusters: MoodSummaryCluster[] = MOOD_IDS.map((id) => ({
    moodId: id,
    count: tally.get(id) ?? 0,
  })).filter((c) => c.count >= MIN_CLUSTER_SIZE);

  const summary: WatchlistMoodSummary = { clusters };
  cache.set(ctx.userId, summary);
  return summary;
}

export function invalidate(userId: string): void {
  cache.delete(userId);
}

/** Test-only. */
export function __resetMoodCache(): void {
  cache.clear();
}
