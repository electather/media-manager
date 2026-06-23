/**
 * Service-level read accessors for `watchlist_items` and `user_watchlist_seed`.
 * Cross-module callers import from media barrel, not `../repo`, to keep repo private (consolidation design §J).
 */
export {
  listActiveRowsKeyset,
  listAllActiveRows,
  listAvailableCandidates,
  hasActiveRows,
} from "../repo/reads";
export { hasUserSeeded, listSeededUserIds } from "../repo/seed";
