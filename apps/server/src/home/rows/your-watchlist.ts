import { hasAny } from "../../watchlist";
import { makePipelineRow } from "../internal/pipeline";
import { yourWatchlistSource } from "../sources/your-watchlist";

// Watchlist titles with status === "available". Reads through `yourWatchlistSource`
// so home row and `/watchlist` page share one source of truth. Eligibility: non-empty internal table
// or connected `watchlist@v1` plugin. Unified `CompactMediaItem` carries `addedAt`/`addedSource`
// (design §D), so home exposes same shape as `/watchlist` page. Source returns bounded preview; pipeline mints `cursor: null`.
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
  // The source already emits the unified `CompactMediaItem` (carrying
  // `addedAt`/`addedSource`), assignable to `InternalCompactMediaItem`; no
  // projection needed.
  project: (_ctx, rows) => rows,
});

export default provider;
