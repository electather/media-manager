import { registerDelivery } from "./delivery";
import { registerDemo } from "./demo";
import { registerStalePendingSweep } from "./stale-pending-sweep";
import { registerOnJobsRunFailed } from "./on-jobs-run-failed";
import { registerOnJobsSyncSucceeded } from "./on-jobs-sync-succeeded";
import { registerOnMediaConnectionAuthExpired } from "./on-media-connection-auth-expired";
import { registerOnPluginRuntimeNotifyRequested } from "./on-plugin-runtime-notify-requested";

export interface RegisterJobsOptions {
  /**
   * When `false`, scheduled cron-driven registrations (e.g. the
   * stale-pending-sweep) are skipped — for callers running without a
   * persistent scheduler. Defaults to `true`.
   */
  scheduled?: boolean;
}

/**
 * Registers every notification job at boot. Invoked from
 * `apps/server/src/index.ts` in alphabetical module order; ordering inside
 * this function is registration-order — handlers fan out sequentially so
 * adding a new handler in the middle could shift downstream timings.
 *
 * `scheduled: false` skips croner-backed registrations so a caller without a
 * persistent scheduler still wires triggerable jobs and event handlers.
 */
export function registerJobs(opts: RegisterJobsOptions = {}): void {
  const scheduled = opts.scheduled ?? true;
  registerDelivery();
  registerDemo();
  if (scheduled) registerStalePendingSweep();
  registerOnJobsRunFailed();
  registerOnJobsSyncSucceeded();
  registerOnMediaConnectionAuthExpired();
  registerOnPluginRuntimeNotifyRequested();
}
