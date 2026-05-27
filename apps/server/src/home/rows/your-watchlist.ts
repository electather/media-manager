import { hasAny } from "../../watchlist";
import type { RowProvider } from "../internal/types";
import { yourWatchlistSource } from "../sources/your-watchlist";

/**
 * Watchlist titles the user can already play (status === "available"). Reads
 * through `yourWatchlistSource` (which delegates to the internal watchlist
 * service) so the home row and the `/watchlist` page share one source of
 * truth. Eligibility flips on either a non-empty internal table or a connected
 * `watchlist@v1` plugin so users see the row even before the first sync runs.
 *
 * The row no longer strips `addedAt`/`addedSource` — the unified
 * `CompactMediaItem` carries them now, so home exposes the same shape as the
 * `/watchlist` page (design §D).
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
    const { rows, partial } = await yourWatchlistSource.fetchRawSet(ctx, undefined, null);
    return { items: rows, cursor: null, partial };
  },
};

export default provider;
