import type { QueryClient } from "@tanstack/react-query";
import { watchlistKeys } from "./query-keys";

/**
 * Sweep every watchlist cache after a mutation. All per-section keys nest
 * under `watchlistKeys.root`, so one invalidation covers Tonight, Recently,
 * Items, Moods, MoodItems, and Counts.
 */
export function invalidateWatchlistAll(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: watchlistKeys.root });
}
