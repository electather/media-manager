import { registerOnWatchlistItemAdded } from "./on-watchlist-item-added";
import { registerOnWatchlistItemRemoved } from "./on-watchlist-item-removed";
import { registerSyncPluginWatchlist } from "./sync-plugin-watchlist";

export { WATCHLIST_SYNC_JOB_ID } from "./sync-plugin-watchlist";

/**
 * Registers every watchlist job at boot. Invoked exactly once from
 * `apps/server/src/index.ts`. The mutation handlers carry no idempotency guard
 * (matching the notifications convention) because this single registration site
 * is what prevents duplicate subscriptions — call it more than once per process
 * and each event would fan out its cache invalidation twice.
 */
export function registerJobs(): void {
  registerOnWatchlistItemAdded();
  registerOnWatchlistItemRemoved();
  registerSyncPluginWatchlist();
}
