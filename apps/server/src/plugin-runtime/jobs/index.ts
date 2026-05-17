import { registerStoreSweepJob } from "./store-sweep";

/** Registers every plugin-runtime job at boot. Invoked from `apps/server/src/{index,worker}.ts` in alphabetical module order. */
export function registerJobs(): void {
  registerStoreSweepJob();
}
