import { registerHydrateLibraryJob } from "./hydrate-library";
import { registerSyncLibraryJob } from "./sync-library";

export { LIBRARY_SYNC_JOB_ID } from "./sync-library";
export { LIBRARY_HYDRATE_JOB_ID } from "./hydrate-library";

/** Registers every library background job. Called once from the server bootstrap. */
export function registerJobs(): void {
  registerSyncLibraryJob();
  registerHydrateLibraryJob();
}
