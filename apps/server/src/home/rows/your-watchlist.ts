import { hasAny } from "../../watchlist";
import { makePipelineRow } from "../internal/pipeline";
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
 * `/watchlist` page (design §D). The source returns a bounded preview, so the
 * shared pipeline mints `cursor: null` (the row never paginates).
 */
const provider = makePipelineRow({
  rowId: "yourWatchlist",
  kind: "yourWatchlist",
  titleKey: "home_row_yourWatchlist_header",
  cursorMode: yourWatchlistSource.stages.cursorMode,
  source: yourWatchlistSource,
  params: undefined,
  eligibility: async (ctx) => {
    if (await hasAny(ctx.userId)) return true;
    return ctx.mediaService.hasCapabilityProvider("watchlist", "v1", "user");
  },
  initialCursor: async () => null,
  // `WatchlistItem` is structurally an `InternalCompactMediaItem` (it carries
  // the unified `addedAt`/`addedSource`); no projection needed.
  project: (_ctx, rows) => rows,
});

export default provider;
