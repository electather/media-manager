import { registerOnWatchlistItemAdded } from "./on-watchlist-item-added";
import { registerOnWatchlistItemRemoved } from "./on-watchlist-item-removed";
import { registerSyncPluginWatchlist } from "./sync-plugin-watchlist";

export { WATCHLIST_SYNC_JOB_ID } from "./sync-plugin-watchlist";

export function registerJobs(): void {
  registerOnWatchlistItemAdded();
  registerOnWatchlistItemRemoved();
  registerSyncPluginWatchlist();
}
