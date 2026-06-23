import { registerStaleClientSweep } from "./stale-client-sweep";

export interface RegisterJobsOptions {
  /**
   * When `false`, scheduled cron-driven registrations (the stale OAuth client
   * sweep) are skipped — for callers running without a persistent scheduler.
   * Defaults to `true`.
   */
  scheduled?: boolean;
}

/**
 * Registers the auth module's jobs. Called from `apps/server/src/index.ts` in
 * fixed alphabetical order (enforced by boot.test.ts) for deterministic fan-out.
 * `scheduled: false` skips the croner-backed stale-client sweep for scheduler-less callers.
 */
export function registerJobs(opts: RegisterJobsOptions = {}): void {
  const scheduled = opts.scheduled ?? true;
  if (scheduled) registerStaleClientSweep();
}
