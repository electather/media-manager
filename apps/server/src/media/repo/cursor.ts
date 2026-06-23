/**
 * Keyset resume position: `(addedAt, id)` pair for `listActiveRowsKeyset`.
 * Opaque wire cursor uses `media/cursor.ts` codec; keyset sources carry pair
 * in cursor's `k` as `"addedAt:id"` (see `watchlist/sources/keyset.ts`).
 */
export interface PageCursor {
  addedAt: number;
  id: string;
}
