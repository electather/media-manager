import type { MediaType } from "@nama/shared/media";
import { extractTmdbId, type MediaSource } from "../../media";
import type { MediaKey } from "../rows/_shared";

/** Seed the consumer envelope resolves (from history, or a detail page). */
export interface SimilarSeedParams {
  seedId: string;
  seedType: MediaType;
}

/**
 * Probes `metadata@v1.getSimilar` entry for `{ tmdbId, type }`.
 * Owned here so entry-shape rules live next to producer.
 */
function toSimilarHit(value: unknown): MediaKey | null {
  const tmdbId = extractTmdbId(value);
  if (!tmdbId) return null;
  const t = (value as { type?: string }).type;
  const type: MediaType = t === "tv" || t === "show" ? "tv" : "movie";
  return { tmdbId, type };
}

/**
 * Serves both `becauseYouWatched` and `similarTo` rows (design §H/§M.5).
 * Returns `{ tmdbId, type }` keys in feed order (invariant V.MC1).
 * Plugin soft-failure surfaces as `partial: true` for degraded row (US-022/US-023).
 */
export const similarSource: MediaSource<SimilarSeedParams, MediaKey> = {
  sourceId: "similar",
  async fetchRawSet(ctx, params) {
    const res = await ctx.mediaService.getSimilarFeed({
      id: params.seedId,
      type: params.seedType,
      ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
    });
    const rows = (res.items as unknown[])
      .map(toSimilarHit)
      .filter((k): k is MediaKey => k !== null);
    return { rows, partial: res.partial };
  },
  // `"none"`: the feed is ranked by relevance, so the pipeline preserves order.
  // Offset: similar feeds page by index, same as the old per-row cursor.
  stages: { sort: "none", cursorMode: "offset" },
};
