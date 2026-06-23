import { registerOnWatchlistItemAdded } from "./on-watchlist-item-added";
import { registerOnWatchlistItemRemoved } from "./on-watchlist-item-removed";
import { registerSyncPluginWatchlist } from "./sync-plugin-watchlist";

export { WATCHLIST_SYNC_JOB_ID } from "./sync-plugin-watchlist";

/**
 * Boot-time registration (invoked once from `apps/server/src/index.ts`).
 * Mutation handlers have no idempotency guard (notifications convention) because
 * single registration site prevents duplicates — calling twice fans event twice.
 */
export function registerJobs(): void {
  registerOnWatchlistItemAdded();
  registerOnWatchlistItemRemoved();
  registerSyncPluginWatchlist();
}
