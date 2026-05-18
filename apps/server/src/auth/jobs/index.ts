/**
 * Auth registers no scheduled or event-driven jobs in Phase 3b. The empty
 * `registerJobs()` exists for uniform entry-point wiring — boot.test.ts
 * asserts alphabetical call order across all modules, so every module must
 * expose this function even when it has nothing to register.
 */
export function registerJobs(): void {
  // no-op
}
