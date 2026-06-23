import type { TopContributor } from "@nama/shared/catalog";
import type { MediaType } from "@nama/shared/media";
import type { MediaSource } from "../../media";
import type { MediaKey } from "../rows/_shared";

/** A recommendation candidate keyed for catalog lookup, carrying its rec-list contributors. */
export interface RecommendedKey extends MediaKey {
  topContributors: TopContributor[];
}

/**
 * Recommendations source (design §H/§M.5). One source serves both TV and movies
 * (differ by `mediaType` partition). Loads default list, filters type, drops available
 * titles, returns survivors in rec-list order (invariant V.MC1). Catalog is source of
 * truth; per-row slice + `topContributors` hookup stay home-side until US-022.
 */
export const recommendedForYouSource: MediaSource<MediaType, RecommendedKey> = {
  sourceId: "recommendedForYou",
  async fetchRawSet(ctx, mediaType) {
    // Read through the request-scoped memo when the consumer injected it (home
    // shares one rec-list fetch across both partitions + eligibility); fall
    // back to a direct fetch when it is absent. The fallback arm only fires for
    // a memo-less `RowContext` (tests / manual construction) — `buildContext`
    // always injects the memo.
    const rec = await (ctx.recommendations
      ? ctx.recommendations()
      : ctx.catalog.getRecommendations(ctx.userId, "default"));
    if (!rec) return { rows: [], partial: false };
    const pool = rec.items.filter((item) => item.mediaType === mediaType);
    if (pool.length === 0) return { rows: [], partial: false };
    // `mediaRequest@v1.getStatusBatch` keys on composite ids (`movie:550`).
    const compositeIds = pool.map((p) => `${p.mediaType}:${p.tmdbId}`);
    const statuses = await ctx.statusBatch.get(compositeIds);
    const rows = pool
      .filter((p) => statuses[`${p.mediaType}:${p.tmdbId}`] !== "available")
      .map((p) => ({ tmdbId: p.tmdbId, type: p.mediaType, topContributors: p.topContributors }));
    return { rows, partial: false };
  },
  // `"none"`: the rec list is already ranked by score, so the pipeline preserves
  // order. Offset: recommendation rows page by index off the filtered pool.
  stages: { sort: "none", cursorMode: "offset" },
};
