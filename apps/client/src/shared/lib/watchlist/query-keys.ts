import type { WatchlistListFilter } from "@ent-mcp/shared/watchlist";

export interface WatchlistListKeyOpts {
  filter?: WatchlistListFilter;
}

/**
 * Filter rides on the query key so React Query treats `(filter:undefined)`
 * and `(filter:"ready")` as separate caches — the server short-circuits
 * enrichment for the filtered shape, so they would otherwise pollute each
 * other. `lists()` returns the parent key shared by every filtered variant,
 * so a single `invalidateQueries({ queryKey: watchlistKeys.lists() })`
 * sweeps them all after a mutation.
 */
export const watchlistKeys = {
  all: ["watchlist"] as const,
  lists: () => [...watchlistKeys.all, "list"] as const,
  list: (opts: WatchlistListKeyOpts = {}) =>
    [...watchlistKeys.lists(), opts.filter ?? null] as const,
  counts: () => [...watchlistKeys.all, "counts"] as const,
} as const;
