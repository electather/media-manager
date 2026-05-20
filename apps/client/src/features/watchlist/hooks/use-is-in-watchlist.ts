import { useQueryClient } from "@tanstack/react-query";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { watchlistKeys } from "../lib/query-keys";

/**
 * Returns true when the watchlist cache currently holds a row with the given
 * composite id. Returns false when the cache is cold or the row is absent;
 * cross-feature callers should compose `id` via the shared `keyToId` helper.
 */
export function useIsInWatchlist(id: string): boolean {
  const qc = useQueryClient();
  const data = qc.getQueryData<WatchlistResponse>(watchlistKeys.list());
  return data?.items.some((i) => i.id === id) ?? false;
}
