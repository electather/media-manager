import { z } from "zod";
import type { MediaType } from "@ent-mcp/shared/media";
import { decodeCursor, encodeCursor } from "../internal/cursor";
import type { RowContext, RowPage, RowProvider } from "../internal/types";
import { recommendedForYouSource } from "../sources/recommended-for-you";
import { loadCanonicalItems } from "./_shared";

const PAGE_SIZE = 12;
const cursorSchema = z.object({ offset: z.number().int().min(0) });

/**
 * Shared body for `recommendedForYou-tv` / `recommendedForYou-movies`.
 * Keeps the per-row file thin (config only) so adding a third partition
 * (e.g. anime) is one filter swap.
 */
export function makeRecommendedForYou(config: {
  rowId: string;
  titleKey: string;
  eyebrowKey?: string;
  mediaType: MediaType;
}): RowProvider {
  return {
    rowId: config.rowId,
    kind: "recommendedForYou",
    titleKey: config.titleKey,
    ...(config.eyebrowKey ? { eyebrowKey: config.eyebrowKey } : {}),
    async eligibility(ctx) {
      const rec = await ctx.catalog.getRecommendations(ctx.userId, "default");
      if (!rec) return false;
      return rec.items.some((item) => item.mediaType === config.mediaType);
    },
    async initialCursor() {
      return null;
    },
    async fetchPage(ctx, cursor) {
      return fetchPage(ctx, cursor, config.mediaType);
    },
  };
}

async function fetchPage(
  ctx: RowContext,
  cursor: string | null,
  mediaType: MediaType,
): Promise<RowPage> {
  const page = cursor === null ? { offset: 0 } : decodeCursor(cursor, cursorSchema);
  // The rec-list load, media-type partition, and `available` drop moved into
  // `recommendedForYouSource.fetchRawSet`; this row keeps the slice, the
  // catalog projection, and the cursor.
  const { rows } = await recommendedForYouSource.fetchRawSet(ctx, mediaType, null);
  const slice = rows.slice(page.offset, page.offset + PAGE_SIZE);
  const items = await loadCanonicalItems(ctx, slice, {
    fromOptions: (p) => ({ topContributors: p.topContributors }),
  });
  const next =
    rows.length > page.offset + PAGE_SIZE
      ? encodeCursor({ offset: page.offset + PAGE_SIZE })
      : null;
  return { items, cursor: next, partial: false };
}
