import { z } from "zod";

export const MIN = 60;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const mediaType = z.enum(["movie", "tv"]);

const idBundle = z
  .object({
    tmdb_id: z.string().optional(),
    imdb_id: z.string().optional(),
    tvdb_id: z.string().optional(),
    trakt_id: z.string().optional(),
    trakt_slug: z.string().optional(),
  })
  .default({});

export const mediaItem = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  type: mediaType,
  genres: z.array(z.string()).default([]),
  rating: z.number().nullable(),
  overview: z.string().default(""),
  posterUrl: z.string().nullable(),
  ids: idBundle,
  runtime: z.number().nullable().optional(),
  originalLanguage: z.string().nullable().optional(),
  cast: z.array(z.string()).optional(),
  director: z.string().nullable().optional(),
  writers: z.array(z.string()).optional(),
  creators: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
});

export type MediaItemShape = z.infer<typeof mediaItem>;

export const historyEntry = z.object({
  item: mediaItem,
  watchedAt: z.string(),
  progress: z.number().nullable().optional(),
  rewatchCount: z.number().optional(),
});

export const watchlistEntry = z.object({
  item: mediaItem,
  addedAt: z.string(),
});

export const inProgressEntry = z.object({
  item: mediaItem,
  /** Within-content position. Episodes for TV, the movie itself for movies. */
  watchedMs: z.number(),
  /** Total runtime in ms. Zero/negative when the source could not measure it;
   *  the host treats those as "in-progress, progress unmeasurable" and omits
   *  the wire `progress` field rather than rendering a broken bar. */
  durationMs: z.number(),
  /** ISO timestamp of the most recent watch event for sort. */
  lastWatchedAt: z.string(),
  /** TV-only — `{ season, episode, name? }` for the in-progress episode. */
  episode: z
    .object({
      season: z.number(),
      episode: z.number(),
      name: z.string().optional(),
    })
    .optional(),
  /** TV-only season position, e.g. `2/12 watched`. */
  episodeProgress: z
    .object({
      watched: z.number(),
      total: z.number(),
    })
    .optional(),
});
