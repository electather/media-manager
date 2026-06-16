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
 * Registers the auth module's jobs. Invoked from `apps/server/src/index.ts` in
 * fixed alphabetical module order so handler fan-out timing stays
 * deterministic — boot.test.ts enforces this.
 *
 * `scheduled: false` skips the croner-backed stale-client sweep so a caller
 * without a persistent scheduler can still boot.
 */
export function registerJobs(opts: RegisterJobsOptions = {}): void {
  const scheduled = opts.scheduled ?? true;
  if (scheduled) registerStaleClientSweep();
}
