import type { MediaSourceId, MediaType } from "@nama/shared/media";

/** Media query-key root + factory (design §B1, V.CL1). Single `invalidateQueries(mediaKeys.root)` sweeps whole surface (#505). `source(sourceId, params)` folds request params into key (#514). */
export const mediaKeys = {
  root: ["media"] as const,
  source: (sourceId: MediaSourceId, params?: Record<string, unknown>) =>
    [...mediaKeys.root, "source", sourceId, params ?? null] as const,
  // Prefix for one source across every param variant: resetQueries here sweeps
  // all filter combinations of that source without touching other sources (#514).
  sourceAll: (sourceId: MediaSourceId) => [...mediaKeys.root, "source", sourceId] as const,
  title: (type: MediaType, tmdbId: string) => [...mediaKeys.root, "title", type, tmdbId] as const,
  // Season availability is a separate read from the title details, but it must
  // still nest under `mediaKeys.root` so a post-mutation
  // `invalidateQueries({ queryKey: mediaKeys.root })` sweeps it too (V.CL1).
  seasonAvailability: (tmdbId: string) =>
    [...mediaKeys.root, "season-availability", tmdbId] as const,
  moods: () => [...mediaKeys.root, "moods"] as const,
} as const;
