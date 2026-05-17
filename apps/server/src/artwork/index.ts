export { ArtworkService } from "./service";

/**
 * No-op for now. Artwork has no scheduled jobs and no event handlers in
 * Phase 2; Phase 3 retrofit will introduce `jobs/index.ts` and replace this
 * stub. Boot tests exercise the call site to keep alphabetical wiring stable.
 */
export function registerJobs(): void {
  /* no-op until Phase 3 */
}
