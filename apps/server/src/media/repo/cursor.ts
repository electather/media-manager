/**
 * Keyset resume position for `listActiveRowsKeyset` — the `(addedAt, id)` pair a
 * paginated read continues past. The opaque wire cursor is now the unified
 * `media/cursor.ts` codec (`encode`/`decode`); keyset sources carry this pair
 * inside the cursor's `k` as `"addedAt:id"` (see `watchlist/sources/keyset.ts`).
 */
export interface PageCursor {
  addedAt: number;
  id: string;
}
