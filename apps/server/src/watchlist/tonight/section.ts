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
  listActiveRows,
  loadProgressMap,
  previewForClassify,
  type ActiveRow,
  type MediaEnrichContext,
} from "../../media";
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
// fallow-ignore-next-line complexity
export async function getSection(ctx: MediaEnrichContext): Promise<WatchlistSectionResponse> {
  // fallow-ignore-next-line code-duplication
  const hit = cache.get(ctx.userId);
  if (hit) return hit;

  const rows = await listActiveRows(ctx.userId);
  if (rows.length === 0) {
    const empty: WatchlistSectionResponse = { items: [], partial: false };
    cache.set(ctx.userId, empty);
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

  // US-007 / round-3 BLOCKING 1: fan-out via Promise.allSettled so a single
  // plugin probe failure cannot drop the whole pre-filter; matches the
  // pattern already in `getCounts` and `listAvailable`.
  const serverProbes = await Promise.allSettled(
    rows.map((row) =>
      getMatchingServersCached(ctx.userId, ctx.mediaService, row.tmdbId, row.mediaType),
    ),
  );
  const candidates: ActiveRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const probe = serverProbes[i]!;
    const servers = probe.status === "fulfilled" ? probe.value : [];
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
  // fallow-ignore-next-line code-duplication
  const section: WatchlistSectionResponse = {
    items: result.items,
    partial: enriched.partial || result.partial,
  };
  cache.set(ctx.userId, section);
  return section;
}

export function invalidateTonightSection(userId: string): void {
  cache.delete(userId);
}

/** Test-only. */
export function __resetTonightCache(): void {
  cache.clear();
}

export type { WatchlistItem };
