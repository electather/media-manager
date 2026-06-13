import consola from "consola";
import { registerDailyRebuild } from "./daily-rebuild";
import { registerIncrementalRebuild } from "./incremental-rebuild";
import { registerManualRebuild } from "./manual-rebuild";

export interface RegisterJobsOptions {
  /**
   * When `false`, scheduled cron-driven registrations (the daily rebuild
   * sweep) are skipped — for callers running without a persistent scheduler.
   * Defaults to `true`.
   */
  scheduled?: boolean;
}

/**
 * Registers the three jobs the preference engine owns. Invoked from
 * `apps/server/src/index.ts` in fixed alphabetical module order so handler
 * fan-out timing stays deterministic — boot.test.ts enforces this.
 *
 * `scheduled: false` skips the croner-backed daily-rebuild registration so a
 * caller without a persistent scheduler can still register the triggerable
 * manual-rebuild + coalesced incremental-update jobs.
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
