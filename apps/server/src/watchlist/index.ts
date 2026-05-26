/**
 * Public barrel for `watchlist/`. Boundaries test rule: re-exports come only
 * from `./service`, `./errors`, and `./jobs`. Internal `repo.ts`, `enrich.ts`,
 * and individual files under `./jobs/` are intentionally not re-exported. The
 * `watchlist_items` write events moved to media (design §M.2); the lone
 * subscriber (`./jobs/on-watchlist-mutation`) imports them from the media barrel.
 */
export {
  // fallow-ignore-next-line code-duplication
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
export { WatchlistError, WatchlistNotFoundError } from "./errors";
export { registerJobs, WATCHLIST_SYNC_JOB_ID } from "./jobs";
