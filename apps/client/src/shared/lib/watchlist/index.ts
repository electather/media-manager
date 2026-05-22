export {
  fetchWatchlist,
  fetchWatchlistCounts,
  addToWatchlist,
  removeFromWatchlist,
  type FetchWatchlistArgs,
} from "./fetchers";
export { watchlistKeys, type WatchlistListKeyOpts } from "./query-keys";
export { buildOptimistic } from "./build-optimistic";
export { invalidateWatchlistAll } from "./invalidate";
export { WatchlistApiError, sourceLabel, type WatchlistItem } from "./types";
