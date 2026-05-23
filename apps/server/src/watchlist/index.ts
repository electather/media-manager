/**
 * Public barrel for `watchlist/`. Boundaries test rule: re-exports come only
 * from `./service`, `./events`, `./errors`, and `./jobs`. Internal `repo.ts`,
 * `enrich.ts`, and individual files under `./jobs/` are intentionally not
 * re-exported.
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
  getTonightSection,
  getRecentlyAdded,
  getMoodSummary,
  listMoodItems,
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
