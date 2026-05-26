import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { ArtworkService } from "../../artwork";
import { enrichCompactItems } from "../../media";
import { pickMatchReason } from "./match-reason";
import type { InternalCompactMediaItem, RowContext } from "./types";

/**
 * Home-specific adapter around media-owned compact enrichment. Media owns the
 * shared status, availability, facets, and artwork work; home only supplies
 * artwork wiring and the row-aware match-reason callback.
 */
export async function enrichHomeItems(
  items: InternalCompactMediaItem[],
  ctx: RowContext,
  opts: { rowId: string },
): Promise<{ items: CompactMediaItem[]; partial: boolean }> {
  const result = await enrichCompactItems(
    items,
    {
      userId: ctx.userId,
      mediaService: ctx.mediaService,
      catalog: ctx.catalog,
      deadlineMs: ctx.deadlineMs,
      log: ctx.logger,
      statusBatch: ctx.statusBatch,
      getArtwork: (requests, artworkOpts) =>
        new ArtworkService(ctx.userId, ctx.catalog).getArtwork(requests, undefined, artworkOpts),
    },
    {
      matchReason: (item) => pickMatchReason(opts.rowId, item, ctx),
    },
  );
  return { items: result.items, partial: result.partial };
}
