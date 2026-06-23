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

// Registers all notification jobs at boot (invoked from index.ts). Handlers fan out sequentially
// so middle insertions shift timings. scheduled: false skips cron registrations for non-persistent schedulers.
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
