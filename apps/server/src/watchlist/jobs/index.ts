import { registerSyncPluginWatchlist } from "./sync-plugin-watchlist";

export { WATCHLIST_SYNC_JOB_ID } from "./sync-plugin-watchlist";

export function registerJobs(): void {
  registerSyncPluginWatchlist();
}
