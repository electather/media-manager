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
   * stale-pending-sweep) are skipped. Cloudflare Workers has no persistent
   * process to run croner schedules, so the Worker entry point passes
   * `false` here while the Node entry point uses the default.
   */
  scheduled?: boolean;
}

/**
 * Registers every notification job at boot. Invoked from
 * `apps/server/src/{index,worker}.ts` in alphabetical module order; ordering
 * inside this function is registration-order — handlers fan out sequentially
 * so adding a new handler in the middle could shift downstream timings.
 *
 * `scheduled: false` skips croner-backed registrations so the Worker runtime
 * (no persistent process, no scheduler) still wires triggerable jobs and
 * event handlers without crashing on a cron-schedule attempt.
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
