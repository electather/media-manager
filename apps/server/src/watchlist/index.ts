/**
 * Public barrel: re-exports from `./service`, `./errors`, `./jobs` only.
 * `watchlist_items` write events moved to media (design §M.2); subscribers
 * import from media barrel.
 */
export {
  // fallow-ignore-next-line code-duplication
  getItems,
  addItem,
  removeItem,
  seedFromPlugins,
  syncFromPlugins,
  listAvailable,
  hasAny,
  listItems,
  getTonightSection,
  getRecentlyAdded,
  getMoodSummary,
  listMoodItems,
  watchlistMediaSources,
  type GetItemsOptions,
  type ListItemsOptions,
  type ListMoodItemsOptions,
  type WatchlistContext,
  type AddItemResult,
  type SeedResult,
} from "./service";
export { WatchlistError, WatchlistNotFoundError } from "./errors";
export { registerJobs, WATCHLIST_SYNC_JOB_ID } from "./jobs";
