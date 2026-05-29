import type { TopContributor } from "@ent-mcp/shared/catalog";
import type { MediaType } from "@ent-mcp/shared/media";
import type { MediaSource } from "../../media";
import type { MediaKey } from "../rows/_shared";

/** A recommendation candidate keyed for catalog lookup, carrying its rec-list contributors. */
export interface RecommendedKey extends MediaKey {
  topContributors: TopContributor[];
}

/**
 * Recommendations source (design §H/§M.5). One source serves both the
 * `recommendedForYou-tv` and `recommendedForYou-movies` rows — they differ
 * only in the `mediaType` partition, which rides in `params`. `fetchRawSet`
 * loads the user's default rec list, keeps the requested media type, drops
 * titles the user can already play (`mediaRequest@v1` status `available`), and
 * returns the surviving candidates as raw keys in rec-list (relevance) order
 * and nothing else (invariant V.MC1). The catalog is the source of truth, so
 * the source never partials; the per-row slice/cursor + catalog projection +
 * `topContributors` match-reason hookup stay home-side until US-022.
 */
export const recommendedForYouSource: MediaSource<MediaType, RecommendedKey> = {
  sourceId: "recommendedForYou",
  async fetchRawSet(ctx, mediaType) {
    const rec = await ctx.catalog.getRecommendations(ctx.userId, "default");
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
