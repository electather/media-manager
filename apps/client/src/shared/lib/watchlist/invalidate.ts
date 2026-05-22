import type { QueryClient } from "@tanstack/react-query";
import { watchlistKeys } from "./query-keys";

export function invalidateWatchlistAll(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: watchlistKeys.lists() });
  void qc.invalidateQueries({ queryKey: watchlistKeys.counts() });
}
