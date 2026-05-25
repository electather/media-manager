/**
 * Public barrel for `watchlist/`. Boundaries test rule: re-exports come only
 * from `./service`, `./events`, `./errors`, and `./jobs`. Row listing,
 * classify, enrich, and availability-cache live in `../media` (canonical
 * implementation shared with home). Writes live under `./internal/repo`.
 */
export {
  getItems,
  getCounts,
  addItem,
  removeItem,
  seedFromPlugins,
  syncFromPlugins,
  listAvailable,
  hasAny,
  listItems,
  listMoodItems,
  getTonightSection,
  getRecentlyAdded,
  getMoodSummary,
  type GetItemsOptions,
  type ListItemsOptions,
  type ListMoodItemsOptions,
  type WatchlistContext,
  type AddItemResult,
  type SeedResult,
} from "./service";
export {
  WATCHLIST_EVENTS,
  watchlistItemAddedSchema,
  watchlistItemRemovedSchema,
  type WatchlistItemAddedPayload,
  type WatchlistItemRemovedPayload,
} from "./events";
export { WatchlistError, WatchlistNotFoundError } from "./errors";
export { registerJobs, WATCHLIST_SYNC_JOB_ID } from "./jobs";
