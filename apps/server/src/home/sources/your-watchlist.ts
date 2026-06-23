import type { CompactMediaItem } from "@nama/shared/home";
import type { MediaSource } from "../../media";
import { listAvailable } from "../../watchlist";

/** Bounded preview size for the home `yourWatchlist` row. */
const YOUR_WATCHLIST_PAGE_SIZE = 12;

/**
 * Watchlist-available source (design §H/§M.5). Reads through `listAvailable`
 * so home row and `/watchlist` page share one source. Keeps `addedAt`/`addedSource`
 * (design §D: unified `CompactMediaItem` carries them). Bounded (no cursor), so no pagination.
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
