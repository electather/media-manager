import { z } from "zod";
import { orderBy } from "es-toolkit/array";
import { HttpError } from "../../errors/http-errors";
import { decodeCursor, encodeCursor } from "../cursor";
import type { CanonicalMetadata } from "../../catalog/types";
import { fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowProvider } from "../types";

const PAGE_SIZE = 12;

const cursorSchema = z.object({
  seedId: z.string().min(1),
  seedType: z.enum(["movie", "tv"]),
  offset: z.number().int().min(0),
});

interface SimilarHit {
  tmdbId: string;
  type: "movie" | "tv";
}

/**
 * "Because you watched X" — picks a recently completed seed from the user's
 * watch history and pages similar candidates from the metadata plugin. The
 * cursor pins the seed so subsequent pages cannot accidentally re-key.
 */
const provider: RowProvider = {
  rowId: "becauseYouWatched",
  kind: "becauseYouWatched",
  titleKey: "home_row_becauseYouWatched_header",
  subtitleKey: "home_row_becauseYouWatched_subtitle",
  requiresInitialCursor: true,
  async eligibility(ctx) {
    const history = await ctx.catalog.getUserHistory(ctx.userId);
    if (history.length === 0) return false;
    return ctx.mediaService.hasCapabilityProvider("metadata", "v1", "user");
  },
  async initialCursor(ctx) {
    const history = await ctx.catalog.getUserHistory(ctx.userId);
    if (history.length === 0) return null;
    // Most recent completed event drives the seed; orderBy desc on watchedAt
    // gives us the right pick without scanning further.
    const sorted = orderBy(history, [(e) => e.watchedAt], ["desc"]);
    const seed = sorted[0];
    if (!seed) return null;
    return encodeCursor({ seedId: seed.tmdbId, seedType: seed.mediaType, offset: 0 });
  },
  async fetchPage(ctx, cursor) {
    if (cursor === null) {
      throw new HttpError(400, "cursor_required", "becauseYouWatched requires an initial cursor");
    }
    const page = decodeCursor(cursor, cursorSchema);
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
    const metadata = await ctx.catalog.getMetadataBatch(
      slice.map((c) => ({ tmdbId: c.tmdbId, type: c.type })),
    );
    const items: InternalCompactMediaItem[] = [];
    for (const c of slice) {
      const meta = metadata[`${c.type}:${c.tmdbId}`] as CanonicalMetadata | undefined;
      if (meta) items.push(fromCanonicalMetadata(meta));
    }
    const next =
      candidates.length > page.offset + PAGE_SIZE
        ? encodeCursor({ ...page, offset: page.offset + PAGE_SIZE })
        : null;
    return { items, cursor: next, partial: res.partial };
  },
};

// fallow-ignore-next-line complexity
function toSimilarHit(value: unknown): SimilarHit | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const idsRaw = v.ids as Record<string, unknown> | undefined;
  const tmdbId =
    (idsRaw && typeof idsRaw.tmdb_id === "string" && idsRaw.tmdb_id) ||
    (typeof v.tmdbId === "string" && v.tmdbId) ||
    (typeof v.id === "string" && v.id.includes(":") && v.id.split(":")[1]) ||
    null;
  if (!tmdbId) return null;
  const t = v.type as string | undefined;
  const type: "movie" | "tv" = t === "tv" || t === "show" ? "tv" : "movie";
  return { tmdbId, type };
}

export default provider;
