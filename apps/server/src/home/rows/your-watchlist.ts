import { hasAny, listAvailable } from "../../watchlist";
import type { RowProvider } from "../internal/types";

const PAGE_SIZE = 12;

/**
 * Watchlist titles the user can already play (status === "available"). Now
 * delegates to the internal watchlist service so the home row and the
 * `/watchlist` page share one source of truth. Eligibility flips on either a
 * non-empty internal table or a connected `watchlist@v1` plugin so users
 * see the row even before the first sync runs.
 */
const provider: RowProvider = {
  rowId: "yourWatchlist",
  kind: "yourWatchlist",
  titleKey: "home_row_yourWatchlist_header",
  async eligibility(ctx) {
    if (await hasAny(ctx.userId)) return true;
    return ctx.mediaService.hasCapabilityProvider("watchlist", "v1", "user");
  },
  async initialCursor() {
    return null;
  },
  async fetchPage(ctx, cursor) {
    if (cursor) return { items: [], cursor: null, partial: false };
    const { items, partial } = await listAvailable(PAGE_SIZE, {
      userId: ctx.userId,
      mediaService: ctx.mediaService,
      catalog: ctx.catalog,
      ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
      log: ctx.logger,
    });
    // Strip watchlist-only fields the home row pipeline doesn't expose. The
    // shared `CompactMediaItem` shape is a structural subset, so `items`
    // satisfies `RowPage["items"]` once we drop the extras here.
    const compact = items.map(({ addedAt: _addedAt, addedSource: _addedSource, ...rest }) => rest);
    return { items: compact, cursor: null, partial };
  },
};

export default provider;
