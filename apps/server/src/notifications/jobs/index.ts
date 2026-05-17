import { registerDelivery } from "./delivery";
import { registerDemo } from "./demo";
import { registerStalePendingSweep } from "./stale-pending-sweep";
import { registerOnJobsRunFailed } from "./on-jobs-run-failed";
import { registerOnJobsSyncSucceeded } from "./on-jobs-sync-succeeded";
import { registerOnMediaConnectionAuthExpired } from "./on-media-connection-auth-expired";
import { registerOnPluginRuntimeNotifyRequested } from "./on-plugin-runtime-notify-requested";

/**
 * Registers every notification job at boot. Invoked from
 * `apps/server/src/{index,worker}.ts` in alphabetical module order; ordering
 * inside this function is registration-order — handlers fan out sequentially
 * so adding a new handler in the middle could shift downstream timings.
 */
export function registerJobs(): void {
  registerDelivery();
  registerDemo();
  registerStalePendingSweep();
  registerOnJobsRunFailed();
  registerOnJobsSyncSucceeded();
  registerOnMediaConnectionAuthExpired();
  registerOnPluginRuntimeNotifyRequested();
}
