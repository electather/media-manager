import type { MediaType } from "@nama/shared/media";
import { makePipelineRow } from "../internal/pipeline";
import type { RowProvider } from "../internal/types";
import { recommendedForYouSource } from "../sources/recommended-for-you";
import { loadCanonicalItems } from "./_shared";

/**
 * Shared body for `recommendedForYou-tv` / `recommendedForYou-movies`.
 * Keeps the per-row file thin (config only) so adding a third partition
 * (e.g. anime) is one filter swap. The rec-list load, media-type partition,
 * and `available` drop live in `recommendedForYouSource.fetchRawSet`; this row
 * projects the full filtered pool (with its `topContributors` match-reason
 * hookup) and the shared pipeline owns the offset slice + cursor.
 */
export function makeRecommendedForYou(config: {
  rowId: string;
  titleKey: string;
  eyebrowKey?: string;
  mediaType: MediaType;
}): RowProvider {
  return makePipelineRow({
    rowId: config.rowId,
    kind: "recommendedForYou",
    titleKey: config.titleKey,
    ...(config.eyebrowKey ? { eyebrowKey: config.eyebrowKey } : {}),
    cursorMode: recommendedForYouSource.stages.cursorMode,
    source: recommendedForYouSource,
    params: config.mediaType,
    async eligibility(ctx) {
      // Share the request-scoped rec-list fetch with the source and the other
      // partition's row when the memo is present; fall back otherwise.
      const rec = await (ctx.recommendations
        ? ctx.recommendations()
        : ctx.catalog.getRecommendations(ctx.userId, "default"));
      if (!rec) return false;
      return rec.items.some((item) => item.mediaType === config.mediaType);
    },
    initialCursor: async () => null,
    project: (ctx, rows) =>
      loadCanonicalItems(ctx, rows, {
        fromOptions: (p) => ({ topContributors: p.topContributors }),
      }),
  });
}
