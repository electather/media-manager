import { z } from "zod";
import { decodeCursor, encodeCursor } from "../cursor";
import type { CanonicalMetadata } from "../../catalog/types";
import { fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowContext, RowPage, RowProvider } from "../types";

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
  mediaType: "movie" | "tv";
}): RowProvider {
  return {
    rowId: config.rowId,
    kind: "recommendedForYou",
    titleKey: config.titleKey,
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
  mediaType: "movie" | "tv",
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
  const slice = filtered.slice(page.offset, page.offset + PAGE_SIZE);
  const metadata = await ctx.catalog.getMetadataBatch(
    slice.map((p) => ({ tmdbId: p.tmdbId, type: p.mediaType })),
  );
  const items: InternalCompactMediaItem[] = [];
  for (const p of slice) {
    const meta = metadata[`${p.mediaType}:${p.tmdbId}`] as CanonicalMetadata | undefined;
    if (!meta) continue;
    items.push(fromCanonicalMetadata(meta, { topContributors: p.topContributors }));
  }
  const next =
    filtered.length > page.offset + PAGE_SIZE
      ? encodeCursor({ offset: page.offset + PAGE_SIZE })
      : null;
  return { items, cursor: next, partial: false };
}
