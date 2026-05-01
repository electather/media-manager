import { z } from "zod";
import {
  AVAILABILITY_STATUSES,
  EPISODE_STATUSES,
  MEDIA_TYPES,
  SEASON_STATUSES,
  SERIES_STATUSES,
} from "./enums";
import { COMPACT_FIELDS } from "./compact";

export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export const availabilityStatusSchema = z.enum(AVAILABILITY_STATUSES);
export const seriesStatusSchema = z.enum(SERIES_STATUSES);
export const episodeStatusSchema = z.enum(EPISODE_STATUSES);
export const seasonStatusSchema = z.enum(SEASON_STATUSES);

/**
 * Single source of truth for the composite media id pattern.
 * Imported by `peekSchema`, `mediaGetInputSchema`, and `mediaGetManyInputSchema`.
 */
export const MEDIA_ID_REGEX = /^(movie|tv):\d+$/;

export const mediaImageSchema = z
  .object({
    "16/9": z.string().optional(),
    "2/3": z.string().optional(),
    "1/1": z.string().optional(),
  })
  .strict();

export const mediaProgressSchema = z
  .object({
    watched: z.number(),
    total: z.number(),
  })
  .strict();

export const upcomingEpisodeSchema = z
  .object({
    season: z.number().int(),
    episode: z.number().int(),
    airsAt: z.number(),
    name: z.string().optional(),
  })
  .strict();

export const streamLinkSchema = z
  .object({
    source: z.string(),
    url: z.string().optional(),
  })
  .strict();

export const detailEpisodeSchema = z
  .object({
    id: z.string(),
    episode: z.number().int(),
    title: z.string(),
    airDate: z.string(),
    runtime: z.number(),
    status: episodeStatusSchema,
  })
  .strict();

export const detailSeasonSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    episodeCount: z.number().int(),
    status: seasonStatusSchema,
    episodes: z.array(detailEpisodeSchema),
    counts: z
      .object({
        available: z.number().int().optional(),
        requested: z.number().int().optional(),
        upcoming: z.number().int().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const mediaDetailSchema = z
  .object({
    id: z.string().regex(MEDIA_ID_REGEX),
    tmdbId: z.string(),
    mediaType: mediaTypeSchema,
    title: z.string(),
    year: z.number().int().optional(),
    poster: z.string().optional(),
    backdrop: z.string().optional(),
    clearLogo: z.string().optional(),
    overview: z.string().optional(),
    genres: z.array(z.string()).optional(),
    rating: z.number().optional(),
    userRating: z.number().optional(),
    matchReason: z.string().optional(),
    status: availabilityStatusSchema.optional(),
    progress: mediaProgressSchema.optional(),
    episodeProgress: mediaProgressSchema.optional(),
    episode: upcomingEpisodeSchema.optional(),
    runtime: z.string().optional(),
    ageRating: z.string().optional(),
    votes: z.number().optional(),
    audienceScore: z.number().optional(),
    criticScore: z.number().optional(),
    tags: z.array(z.string()).optional(),
    director: z.string().optional(),
    cast: z.array(z.string()).optional(),
    streamLink: streamLinkSchema.optional(),
    trailerUrl: z.string().optional(),
    seriesStatus: seriesStatusSchema.optional(),
    nextAirDate: z.string().optional(),
    seasons: z.array(detailSeasonSchema).optional(),
    ratings: z
      .object({
        tmdb: z.number().optional(),
        trakt: z.number().optional(),
        user: z.number().optional(),
      })
      .strict()
      .optional(),
    streamingOn: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
  })
  .strict();

const compactPickShape = Object.fromEntries(COMPACT_FIELDS.map((k) => [k, true])) as {
  [K in (typeof COMPACT_FIELDS)[number]]: true;
};

export const compactMediaItemSchema = mediaDetailSchema.pick(compactPickShape);

export const mediaGetInputSchema = z
  .object({
    id: z.string().regex(MEDIA_ID_REGEX),
  })
  .strict();
export type MediaGetInput = z.infer<typeof mediaGetInputSchema>;

export const mediaGetManyInputSchema = z
  .object({
    ids: z.array(z.string().regex(MEDIA_ID_REGEX)).max(100),
  })
  .strict();
export type MediaGetManyInput = z.infer<typeof mediaGetManyInputSchema>;

export const mediaGetOutputSchema = mediaDetailSchema;
export const mediaGetManyOutputSchema = z
  .object({
    items: z.array(mediaDetailSchema),
  })
  .strict();
export type MediaGetManyOutput = z.infer<typeof mediaGetManyOutputSchema>;

/** Query for `GET /api/discover/search`. */
export const discoverSearchQuerySchema = z.object({
  query: z.string().min(1),
  mediaType: mediaTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type DiscoverSearchQuery = z.infer<typeof discoverSearchQuerySchema>;

/** Query for `GET /api/discover/trending`. */
export const discoverTrendingQuerySchema = z.object({
  mediaType: mediaTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DiscoverTrendingQuery = z.infer<typeof discoverTrendingQuerySchema>;

/** Query for `GET /api/discover`. */
export const discoverFilterQuerySchema = z.object({
  genres: z.string().optional(),
  yearMin: z.coerce.number().int().optional(),
  yearMax: z.coerce.number().int().optional(),
  ratingMin: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DiscoverFilterQuery = z.infer<typeof discoverFilterQuerySchema>;

/** Query for `GET /api/activity/history`. */
export const activityHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ActivityHistoryQuery = z.infer<typeof activityHistoryQuerySchema>;

/** Query for `GET /api/activity/watchlist`. */
export const activityWatchlistQuerySchema = z.object({
  mediaType: mediaTypeSchema.optional(),
});
export type ActivityWatchlistQuery = z.infer<typeof activityWatchlistQuerySchema>;

/** Body for `POST /api/requests`. */
export const createMediaRequestSchema = z.object({
  id: z.string(),
  seasons: z.string().optional(),
});
export type CreateMediaRequestBody = z.infer<typeof createMediaRequestSchema>;
