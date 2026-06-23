import type { MediaSourceId, MediaType } from "@nama/shared/media";

/**
 * One media query-key root + factory (design §B1, V.CL1). All media reads
 * nest under `mediaKeys.root` so single `invalidateQueries(mediaKeys.root)`
 * after mutation sweeps whole surface (#505); home/watchlist factories derive
 * from this root (#514). `source(sourceId, params)` folds request params into
 * key so each `bucket`/`mood`/`sort`/seed combo has own cache entry.
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
  moods: () => [...mediaKeys.root, "moods"] as const,
} as const;
