/** Registers media module jobs at boot. Media emits events but has no job handlers in this phase. */
export function registerJobs(): void {
  // no-op: media emits events but does not consume them in Phase 3
}
