import type { CompactMediaItem } from "@nama/shared/home";
import type { MediaSource } from "../../media";
import { listAvailable } from "../../watchlist";

/** Bounded preview size for the home `yourWatchlist` row. */
const YOUR_WATCHLIST_PAGE_SIZE = 12;

/**
 * Watchlist-available source (design §H/§M.5). The `yourWatchlist` row reads
 * through the watchlist module boundary (`listAvailable`) so the home row and
 * the `/watchlist` page share one source of truth. `fetchRawSet` returns the
 * already-enriched available titles as raw rows — keeping `addedAt`/`addedSource`
 * (design §D: home no longer strips them now that the unified `CompactMediaItem`
 * carries the fields). A `watchlist@v1` plugin soft-failure rides through as
 * `partial: true`. The row stays bounded (no cursor), so it never paginates.
 */
export const yourWatchlistSource: MediaSource<void, CompactMediaItem> = {
  sourceId: "yourWatchlist",
  async fetchRawSet(ctx) {
    const { items, partial } = await listAvailable(YOUR_WATCHLIST_PAGE_SIZE, {
      userId: ctx.userId,
      mediaService: ctx.mediaService,
      catalog: ctx.catalog,
      ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
      log: ctx.logger,
    });
    return { rows: items, partial };
  },
  // `"none"`: `listAvailable` already returns the bounded, ordered preview.
  // Offset: keeps the row pipeline-ready even though it ships a single page.
  stages: { sort: "none", cursorMode: "offset" },
};
