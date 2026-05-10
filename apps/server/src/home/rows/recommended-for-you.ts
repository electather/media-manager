import { z } from "zod";
import type { MediaType } from "@ent-mcp/shared/media";
import { decodeCursor, encodeCursor } from "../cursor";
import type { RowContext, RowPage, RowProvider } from "../types";
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

// fallow-ignore-next-line complexity
async function fetchPage(
  ctx: RowContext,
  cursor: string | null,
  mediaType: MediaType,
): Promise<RowPage> {
  const page = cursor === null ? { offset: 0 } : decodeCursor(cursor, cursorSchema);
  const rec = await ctx.catalog.getRecommendations(ctx.userId, "default");
  if (!rec) return { items: [], cursor: null, partial: false };
  const pool = rec.items.filter((item) => item.mediaType === mediaType);
  if (pool.length === 0) return { items: [], cursor: null, partial: false };
  // `mediaRequest@v1.getStatusBatch` keys on composite ids (`movie:550`).
  const compositeIds = pool.map((p) => `${p.mediaType}:${p.tmdbId}`);
  const statuses = await ctx.statusBatch.get(compositeIds);
  const filtered = pool.filter((p) => statuses[`${p.mediaType}:${p.tmdbId}`] !== "available");
  const slice = filtered
    .slice(page.offset, page.offset + PAGE_SIZE)
    .map((p) => ({ tmdbId: p.tmdbId, type: p.mediaType, topContributors: p.topContributors }));
  const items = await loadCanonicalItems(ctx, slice, {
    fromOptions: (p) => ({ topContributors: p.topContributors }),
  });
  const next =
    filtered.length > page.offset + PAGE_SIZE
      ? encodeCursor({ offset: page.offset + PAGE_SIZE })
      : null;
  return { items, cursor: next, partial: false };
}
