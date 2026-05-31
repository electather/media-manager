import type { MediaSourceId, MediaType } from "@ent-mcp/shared/media";

/**
 * The one media query-key root + factory (design §B1, invariant V.CL1). Every
 * media read — paginated source pages, title details, the watchlist counts and
 * mood aggregates — nests under `mediaKeys.root`, so a single
 * `invalidateQueries({ queryKey: mediaKeys.root })` after a mutation sweeps the
 * whole surface once (#505). The home and watchlist key factories derive from
 * this root rather than keeping independent ones (#514).
 *
 * `source(sourceId, params)` folds the per-source request params into the key so
 * each `bucket` / `mood` / `sort` / seed combination has its own cache entry,
 * mirroring the old `watchlistKeys.items(opts)` + `homeKeys.row(rowId, cursor)`
 * discriminators under one root.
 */
export const mediaKeys = {
  root: ["media"] as const,
  source: (sourceId: MediaSourceId, params?: Record<string, unknown>) =>
    [...mediaKeys.root, "source", sourceId, params ?? null] as const,
  title: (type: MediaType, tmdbId: string) => [...mediaKeys.root, "title", type, tmdbId] as const,
  // Season availability is a separate read from the title details, but it must
  // still nest under `mediaKeys.root` so a post-mutation
  // `invalidateQueries({ queryKey: mediaKeys.root })` sweeps it too (V.CL1).
  seasonAvailability: (tmdbId: string) =>
    [...mediaKeys.root, "season-availability", tmdbId] as const,
  counts: () => [...mediaKeys.root, "counts"] as const,
  moods: () => [...mediaKeys.root, "moods"] as const,
} as const;
