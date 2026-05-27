import type { MediaType } from "@ent-mcp/shared/media";
import { extractTmdbId, type MediaSource } from "../../media";
import type { MediaKey } from "../rows/_shared";

/** Seed the consumer envelope resolves (from history, or a detail page). */
export interface SimilarSeedParams {
  seedId: string;
  seedType: MediaType;
}

/**
 * Probes a raw `metadata@v1.getSimilar` result entry for `{ tmdbId, type }`.
 * Owned here (the similar source is its only producer) so the entry-shape
 * rules live next to the source that emits them; `_shared.fetchSimilarPage`
 * resolves its candidates through this source rather than re-walking entries.
 */
function toSimilarHit(value: unknown): MediaKey | null {
  const tmdbId = extractTmdbId(value);
  if (!tmdbId) return null;
  const t = (value as { type?: string }).type;
  const type: MediaType = t === "tv" || t === "show" ? "tv" : "movie";
  return { tmdbId, type };
}

/**
 * Similar-feed source (design §H/§M.5). One source serves both the
 * `becauseYouWatched` and `similarTo` rows — they differ only in how the
 * consumer derives the seed (recent history vs a detail page), which lives in
 * the envelope's params/cursor, not the source. `fetchRawSet` fetches the
 * `metadata@v1.getSimilar` candidates for the seed and returns them as raw
 * `{ tmdbId, type }` keys in feed (relevance) order and nothing else (invariant
 * V.MC1). The offset slice + seed-bearing cursor still live in the consumer
 * (`_shared.fetchSimilarPage` + the row cursor) until US-022/US-023 fold them
 * into the shared pipeline; the catalog projection + `seedTitle` match-reason
 * hookup also stay home-side.
 *
 * A plugin soft-failure surfaces as `partial: true` (from `getSimilarFeed`),
 * propagated so the consumer envelope can keep a degraded row.
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
