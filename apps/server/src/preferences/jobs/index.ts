import consola from "consola";
import { registerDailyRebuild } from "./daily-rebuild";
import { registerIncrementalRebuild } from "./incremental-rebuild";
import { registerManualRebuild } from "./manual-rebuild";

export interface RegisterJobsOptions {
  /**
   * When `false`, scheduled cron-driven registrations (the daily rebuild
   * sweep) are skipped. Cloudflare Workers has no persistent process to run
   * croner schedules, so the Worker entry point passes `false` here if it
   * ever wires preferences in. The Node entry point uses the default.
   */
  scheduled?: boolean;
}

/**
 * Registers the three jobs the preference engine owns. Invoked from
 * `apps/server/src/{index,worker}.ts` in fixed alphabetical module order so
 * handler fan-out timing stays deterministic — boot.test.ts enforces this.
 *
 * `scheduled: false` skips the croner-backed daily-rebuild registration so a
 * Workers runtime (no persistent process, no scheduler) can still register
 * the triggerable manual-rebuild + coalesced incremental-update jobs
 * without crashing on a cron-schedule attempt.
 */
export function registerJobs(opts: RegisterJobsOptions = {}): void {
  const scheduled = opts.scheduled ?? true;
  if (scheduled) registerDailyRebuild();
  registerIncrementalRebuild();
  registerManualRebuild();
  consola.debug(
    `[preference] registered ${scheduled ? "daily, " : ""}incremental, and manual-rebuild jobs`,
  );
}
