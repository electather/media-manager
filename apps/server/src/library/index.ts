// Public barrel for library/. Forbids deep imports of ./repo, ./internal/**,
// and individual ./jobs/* files. Exposes phases 1–3: sync, hydrate, facets,
// collections, item-lens registrations (json_each composed into /api/media),
// and cron job registration.
export {
  syncMembership,
  hydrateLibrary,
  getFacets,
  listCollections,
  type LibraryContext,
  type SyncMembershipResult,
  type HydrateOptions,
  type HydrateResult,
} from "./service";
export { libraryMediaSources } from "./internal/media-sources";
export type { MaybeLibraryContext } from "./types";
export { registerJobs, LIBRARY_SYNC_JOB_ID, LIBRARY_HYDRATE_JOB_ID } from "./jobs";
