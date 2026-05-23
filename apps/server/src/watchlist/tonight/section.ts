import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import {
  keyToId,
  type WatchlistItem,
  type WatchlistSectionResponse,
} from "@ent-mcp/shared/watchlist";
import { getMatchingServersCached } from "../availability-cache";
import { classifyBucket, previewForClassify } from "../classify";
import { enrich, type WatchlistEnrichContext } from "../enrich";
import { loadProgressMap } from "../progress";
import * as repo from "../repo";
import { UserTtlCache } from "../user-cache";
import { pick } from "./pick";

const CACHE_TTL_MS = 5 * 60_000;
const cache = new UserTtlCache<WatchlistSectionResponse>(CACHE_TTL_MS);

/**
 * Tonight section: hero + ≤4 alternates from the user's ready / in-progress
 * pool, ranked by `tonight/score.ts`. Pre-filters rows via the same cheap
 * signals `/counts` uses so we don't enrich a 1000-row backlog just to find
 * the top 5. Cached 5 min per user (RISK-007 / V.WL4).
 */
export async function getSection(ctx: WatchlistEnrichContext): Promise<WatchlistSectionResponse> {
  const hit = cache.get(ctx.userId);
  if (hit) return hit;

  const rows = await repo.listAllActive(ctx.userId);
  if (rows.length === 0) {
    const empty: WatchlistSectionResponse = { items: [], partial: false };
    cache.set(ctx.userId, empty);
    return empty;
  }

  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));
  const [statuses, metadata, progress] = await Promise.all([
    ctx.mediaService
      .getStatusBatch(rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType })))
      .catch((err) => {
        ctx.log.warn("[watchlist:tonight] getStatusBatch failed", err);
        return {} as Record<string, string>;
      }),
    ctx.catalog.getMetadataBatch(metadataKeys).catch((err) => {
      ctx.log.warn("[watchlist:tonight] getMetadataBatch failed", err);
      return {} as Record<string, CanonicalMetadata>;
    }),
    loadProgressMap(ctx),
  ]);

  const candidates: repo.WatchlistRow[] = [];
  for (const row of rows) {
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const servers = await getMatchingServersCached(
      ctx.userId,
      ctx.mediaService,
      row.tmdbId,
      row.mediaType,
    ).catch(() => []);
    const preview = previewForClassify(
      metadata[composite],
      statuses[composite],
      servers,
      progress.map.get(composite),
    );
    const bucket = classifyBucket(preview);
    if (bucket === "ready" || bucket === "in-progress") candidates.push(row);
  }
  if (candidates.length === 0) {
    const empty: WatchlistSectionResponse = { items: [], partial: false };
    cache.set(ctx.userId, empty);
    return empty;
  }

  const enriched = await enrich(candidates, ctx);
  const result = pick(enriched.items);
  const section: WatchlistSectionResponse = {
    items: result.items,
    partial: enriched.partial || result.partial,
  };
  cache.set(ctx.userId, section);
  return section;
}

export function invalidate(userId: string): void {
  cache.delete(userId);
}

/** Test-only. */
export function __resetTonightCache(): void {
  cache.clear();
}

export type { WatchlistItem };
