import { orderBy } from "es-toolkit/array";
import { makePipelineRow } from "../internal/pipeline";
import { encodeSeedCursor, similarPagedSource } from "../sources/similar-paged";
import { loadCanonicalItems } from "./_shared";

/**
 * Picks a recently completed seed from watch history, pages similar candidates.
 * Seed rides keyset cursor (similarPagedSource) so pages cannot re-key; initialCursor mints first,
 * pipeline owns slice + next cursor.
 */
const provider = makePipelineRow({
  rowId: "becauseYouWatched",
  kind: "becauseYouWatched",
  titleKey: "home_row_becauseYouWatched_header",
  eyebrowKey: "home_row_becauseYouWatched_eyebrow",
  cursorMode: similarPagedSource.stages.cursorMode,
  requiresInitialCursor: true,
  source: similarPagedSource,
  params: undefined,
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
    return encodeSeedCursor({ seedId: seed.tmdbId, seedType: seed.mediaType });
  },
  project: (ctx, rows) => loadCanonicalItems(ctx, rows),
});

export default provider;
