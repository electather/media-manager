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
 * Registers three preference jobs in alphabetical order (enforced by boot.test.ts).
 * `scheduled: false` skips croner-backed daily rebuild for callers without persistent schedulers.
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
