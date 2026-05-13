import { z } from "zod";
import type { MediaType } from "@ent-mcp/shared/media";
import { decodeCursor, encodeCursor } from "../cursor";
import { extractTmdbId } from "../adapters";
import type { RowProvider } from "../types";
import { loadCanonicalItems, type MediaKey } from "./_shared";

const PAGE_SIZE = 12;

const cursorSchema = z.object({
  tmdbId: z.string().min(1),
  mediaType: z.enum(["movie", "tv"]),
  offset: z.number().int().min(0),
});

type SimilarHit = MediaKey;

/**
 * "Similar to X" — title-specific row for the media detail page. The cursor
 * carries the seed `{ tmdbId, mediaType, offset }` and is constructed by the
 * client from the detail item, so every detail page gets a distinct query
 * keyed to its own seed rather than a generic recommended-for-you feed.
 *
 * `requiresInitialCursor: true` ensures the orchestrator rejects cursor-less
 * calls; `initialCursor` always returns null because the client supplies the
 * seed rather than the server deriving it from history.
 */
const provider: RowProvider = {
  rowId: "similarTo",
  kind: "similarTo",
  titleKey: "media_detail_section_related",
  requiresInitialCursor: true,
  async eligibility(ctx) {
    return ctx.mediaService.hasCapabilityProvider("metadata", "v1", "user");
  },
  async initialCursor(_ctx) {
    return null;
  },
  async fetchPage(ctx, cursor) {
    const page = decodeCursor(cursor!, cursorSchema);
    const res = await ctx.mediaService.getSimilarFeed({
      id: page.tmdbId,
      type: page.mediaType,
      ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
    });
    const seedMeta = await ctx.catalog.getMetadata(page.tmdbId, page.mediaType);
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
