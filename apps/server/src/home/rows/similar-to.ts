import { z } from "zod";
import { decodeCursor, encodeCursor } from "../internal/cursor";
import type { RowProvider } from "../internal/types";
import { fetchSimilarPage } from "./_shared";
import { mediaTypeSchema } from "@ent-mcp/shared";

const PAGE_SIZE = 12;

const cursorSchema = z.object({
  tmdbId: z.string().min(1),
  mediaType: mediaTypeSchema,
  offset: z.number().int().min(0),
});

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
    const { items, hasMore, partial } = await fetchSimilarPage(ctx, {
      id: page.tmdbId,
      type: page.mediaType,
      offset: page.offset,
      pageSize: PAGE_SIZE,
    });
    const next = hasMore ? encodeCursor({ ...page, offset: page.offset + PAGE_SIZE }) : null;
    return { items, cursor: next, partial };
  },
};

export default provider;
