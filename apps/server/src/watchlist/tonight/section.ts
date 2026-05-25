import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import {
  keyToId,
  type WatchlistItem,
  type WatchlistSectionResponse,
} from "@ent-mcp/shared/watchlist";
import {
  classifyBucket,
  enrich,
  getMatchingServersCached,
  loadProgressMap,
  previewForClassify,
  type MatchingServer,
  type WatchlistEnrichContext,
} from "../../media";
import { MemoryCache } from "../../cache/memory";
import * as repo from "../repo";
import { pick } from "./pick";

const CACHE_TTL_MS = 5 * 60_000;
const cache = new MemoryCache(5000);

type SectionContext = Omit<WatchlistEnrichContext, "loadProgressMap">;

function sectionCacheKey(userId: string): string {
  return `watchlist:tonight:${userId}`;
}

/**
 * Tonight section: hero + ≤4 alternates from the user's ready / in-progress
 * pool, ranked by `tonight/score.ts`. Pre-filters rows via the same cheap
 * signals `/counts` uses so we don't enrich a 1000-row backlog just to find
 * the top 5. Cached 5 min per user (RISK-007 / V.WL4).
 */
// fallow-ignore-next-line complexity
export async function getSection(ctx: SectionContext): Promise<WatchlistSectionResponse> {
  const enrichCtx: WatchlistEnrichContext = { ...ctx, loadProgressMap };
  // fallow-ignore-next-line code-duplication
  const key = sectionCacheKey(ctx.userId);
  const hit = await cache.get<WatchlistSectionResponse>(key);
  if (hit !== null) return hit;

  const rows = await repo.listAllActive(ctx.userId);
  if (rows.length === 0) {
    const empty: WatchlistSectionResponse = { items: [], partial: false };
    await cache.set(key, empty, CACHE_TTL_MS);
    return empty;
  }

  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));
  const [statuses, metadata, progress] = await Promise.all([
    // fallow-ignore-next-line code-duplication
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

  // fallow-ignore-next-line code-duplication
  const serverProbes = await Promise.allSettled(
    rows.map((r) => getMatchingServersCached(ctx.userId, ctx.mediaService, r.tmdbId, r.mediaType)),
  );
  const candidates: repo.WatchlistRow[] = [];
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
    if (bucket === "ready" || bucket === "in-progress") candidates.push(row);
  }
  if (candidates.length === 0) {
    const empty: WatchlistSectionResponse = { items: [], partial: false };
    await cache.set(key, empty, CACHE_TTL_MS);
    return empty;
  }

  const enriched = await enrich(candidates, enrichCtx);
  const result = pick(enriched.items);
  // fallow-ignore-next-line code-duplication
  const section: WatchlistSectionResponse = {
    items: result.items,
    partial: enriched.partial || result.partial,
  };
  await cache.set(key, section, CACHE_TTL_MS);
  return section;
}

export async function invalidateTonightSection(userId: string): Promise<void> {
  await cache.delete(sectionCacheKey(userId));
}

/** Test-only. */
export async function __resetTonightCache(): Promise<void> {
  await cache.clear("watchlist:tonight:");
}

export type { WatchlistItem };
