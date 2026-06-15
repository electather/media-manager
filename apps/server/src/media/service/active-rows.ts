/**
 * Service-level read accessors for the `watchlist_items` and
 * `user_watchlist_seed` tables. Cross-module callers (e.g. the watchlist
 * module sources) import these names from the media barrel rather than
 * reaching into `../repo` directly, keeping the repo as a private data layer
 * (consolidation design §J). Write operations live in `writes.ts`.
 */
export {
  listActiveRowsKeyset,
  listAllActiveRows,
  listAvailableCandidates,
  hasActiveRows,
} from "../repo/reads";
export { hasUserSeeded, listSeededUserIds } from "../repo/seed";
