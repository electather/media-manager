import type { MoodId, WatchlistBucket, WatchlistSort } from "@ent-mcp/shared/watchlist";

export interface WatchlistItemsKeyOpts {
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/**
 * Hierarchical query-key factory. Every per-section key nests under
 * `root` so a single `invalidateQueries({ queryKey: watchlistKeys.root })`
 * sweeps Tonight, Recently, Items, Moods, MoodItems and Counts after a
 * mutation. The filter/sort/mood combo on `items()` is part of the key
 * so the curated and `/watchlist/all` caches don't collide.
 */
export const watchlistKeys = {
  root: ["watchlist"] as const,
  counts: () => [...watchlistKeys.root, "counts"] as const,
  tonight: () => [...watchlistKeys.root, "tonight"] as const,
  recently: () => [...watchlistKeys.root, "recently"] as const,
  moods: () => [...watchlistKeys.root, "moods"] as const,
  moodItems: (moodId: MoodId) => [...watchlistKeys.root, "moods", moodId, "items"] as const,
  items: (opts: WatchlistItemsKeyOpts = {}) =>
    [
      ...watchlistKeys.root,
      "items",
      opts.sort ?? "recent",
      opts.bucket ?? null,
      opts.mood ?? null,
    ] as const,
} as const;
