import { z } from "zod";
import { orderBy } from "es-toolkit/array";
import { decodeCursor, encodeCursor } from "../cursor";
import type { RowProvider } from "../types";
import { fetchSimilarPage } from "./_shared";
import { mediaTypeSchema } from "@ent-mcp/shared";

const PAGE_SIZE = 12;

const cursorSchema = z.object({
  seedId: z.string().min(1),
  seedType: mediaTypeSchema,
  offset: z.number().int().min(0),
});

/**
 * "Because you watched X" — picks a recently completed seed from the user's
 * watch history and pages similar candidates from the metadata plugin. The
 * cursor pins the seed so subsequent pages cannot accidentally re-key.
 */
const provider: RowProvider = {
  rowId: "becauseYouWatched",
  kind: "becauseYouWatched",
  titleKey: "home_row_becauseYouWatched_header",
  eyebrowKey: "home_row_becauseYouWatched_eyebrow",
  requiresInitialCursor: true,
  async eligibility(ctx) {
    const history = await ctx.catalog.getUserHistory(ctx.userId);
    if (history.length === 0) return false;
    return ctx.mediaService.hasCapabilityProvider("metadata", "v1", "user");
  },
  async initialCursor(ctx) {
    const history = await ctx.catalog.getUserHistory(ctx.userId);
    if (history.length === 0) return null;
    // Two-tier sort: most recent first, then highest user rating as
    // tie-break. Same-day ties resolve to the user's strongest signal.
    const ratings = await ctx.catalog.getUserRatings(ctx.userId).catch(() => []);
    const ratingByKey = new Map<string, number>();
    for (const r of ratings) ratingByKey.set(`${r.mediaType}:${r.tmdbId}`, r.rating);
    const sorted = orderBy(
      history,
      [(e) => e.watchedAt, (e) => ratingByKey.get(`${e.mediaType}:${e.tmdbId}`) ?? 0],
      ["desc", "desc"],
    );
    const seed = sorted[0];
    if (!seed) return null;
    return encodeCursor({ seedId: seed.tmdbId, seedType: seed.mediaType, offset: 0 });
  },
  async fetchPage(ctx, cursor) {
    // `requiresInitialCursor: true` makes `composeRow` reject null cursors
    // before this runs; the non-null assertion mirrors that invariant.
    const page = decodeCursor(cursor!, cursorSchema);
    const { items, hasMore, partial } = await fetchSimilarPage(ctx, {
      id: page.seedId,
      type: page.seedType,
      offset: page.offset,
      pageSize: PAGE_SIZE,
    });
    const next = hasMore ? encodeCursor({ ...page, offset: page.offset + PAGE_SIZE }) : null;
    return { items, cursor: next, partial };
  },
};

export default provider;
