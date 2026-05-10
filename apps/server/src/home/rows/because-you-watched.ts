import { z } from "zod";
import { orderBy } from "es-toolkit/array";
import type { MediaType } from "@ent-mcp/shared/media";
import { decodeCursor, encodeCursor } from "../cursor";
import { extractTmdbId } from "../adapters";
import type { RowProvider } from "../types";
import { loadCanonicalItems, type MediaKey } from "./_shared";

const PAGE_SIZE = 12;

const cursorSchema = z.object({
  seedId: z.string().min(1),
  seedType: z.enum(["movie", "tv"]),
  offset: z.number().int().min(0),
});

type SimilarHit = MediaKey;

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
    const res = await ctx.mediaService.getSimilarFeed({
      id: page.seedId,
      type: page.seedType,
      ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
    });
    const seedMeta = await ctx.catalog.getMetadata(page.seedId, page.seedType);
    if (seedMeta) ctx.seedTitle = seedMeta.title;
    const candidates = (res.items as unknown[])
      .map(toSimilarHit)
      .filter((c): c is SimilarHit => c !== null);
    const slice = candidates.slice(page.offset, page.offset + PAGE_SIZE);
    const items = await loadCanonicalItems(ctx, slice);
    const next =
      candidates.length > page.offset + PAGE_SIZE
        ? encodeCursor({ ...page, offset: page.offset + PAGE_SIZE })
        : null;
    return { items, cursor: next, partial: res.partial };
  },
};

function toSimilarHit(value: unknown): SimilarHit | null {
  const tmdbId = extractTmdbId(value);
  if (!tmdbId) return null;
  const t = (value as { type?: string }).type;
  const type: MediaType = t === "tv" || t === "show" ? "tv" : "movie";
  return { tmdbId, type };
}

export default provider;
