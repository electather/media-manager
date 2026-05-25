import { register as registerOnWatchlistMutation } from "./on-watchlist-mutation";
import { registerSyncPluginWatchlist } from "./sync-plugin-watchlist";

export { WATCHLIST_SYNC_JOB_ID } from "./sync-plugin-watchlist";

export function registerJobs(): void {
  registerSyncPluginWatchlist();
  registerOnWatchlistMutation();
}
