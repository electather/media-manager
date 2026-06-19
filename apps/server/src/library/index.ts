/**
 * Public barrel for `library/`. Outside code imports only from here — the
 * boundaries rule forbids deep imports of `./repo`, `./internal/**`, and
 * individual files under `./jobs/`. Phases 1–3 expose the membership-sync and
 * denormalized-hydrate surfaces, the facets read, the group-first collections
 * read, the item-lens registrations including the server/quality `json_each`
 * lenses (composed into the unified media registry by the `/api/media`
 * adapter), and the cron job registration.
 */
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
