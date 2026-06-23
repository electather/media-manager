import { z } from "zod";
import { AVAILABILITY_STATUSES, MEDIA_TYPES } from "../media/enums";
import { WATCHLIST_SOURCES } from "../watchlist/enums";
import { MATCH_REASON_KEYS } from "./enums";
import { mediaTypeSchema } from "../media/schema-base";

/** `home.getLayout` takes no input. Strict empty schema rejects extra keys. */
export const homeGetLayoutInputSchema = z.object({}).strict();

const progressSchema = z
  .object({
    watched: z.number(),
    total: z.number(),
  })
  .strict();

const matchReasonSchema = z
  .object({
    key: z.enum(MATCH_REASON_KEYS),
    params: z.record(z.string(), z.string()),
  })
  .strict();

const availabilitySchema = z
  .object({
    hasAnyServerCopy: z.boolean(),
    requestEligible: z.boolean(),
    servers: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const facetsSchema = z
  .object({
    runtimeMin: z.number().optional(),
    episodeCount: z.number().optional(),
    releaseDate: z.string().optional(),
  })
  .strict();

const seriesContextSchema = z
  .object({
    season: z.number(),
    episode: z.number(),
    episodeTitle: z.string(),
    nextUpFromServer: z.boolean(),
  })
  .strict();

const upcomingEpisodeSchema = z
  .object({
    season: z.number(),
    episode: z.number(),
    airsAt: z.number(),
    name: z.string().optional(),
  })
  .strict();

/**
 * Wire-format media item for home rows and command-menu search. Mirrors CompactMediaItem in ./types.
 * Absent fields omitted (not null) to use z.optional() over z.nullable().
 */
export const compactMediaItemSchema = z
  .object({
    id: z.string(),
    tmdbId: z.string(),
    mediaType: z.enum(MEDIA_TYPES),
    title: z.string(),
    year: z.number().optional(),
    poster: z.string().optional(),
    backdrop: z.string().optional(),
    clearLogo: z.string().optional(),
    progress: progressSchema.optional(),
    episodeProgress: progressSchema.optional(),
    overview: z.string().optional(),
    genres: z.array(z.string()).optional(),
    rating: z.number().optional(),
    userRating: z.number().optional(),
    matchReason: matchReasonSchema.optional(),
    status: z.enum(AVAILABILITY_STATUSES).optional(),
    availability: availabilitySchema.optional(),
    facets: facetsSchema.optional(),
    seriesContext: seriesContextSchema.optional(),
    episode: upcomingEpisodeSchema.optional(),
    tags: z.array(z.string()).optional(),
    addedAt: z.number().nullish(),
    addedSource: z.enum(WATCHLIST_SOURCES).nullish(),
  })
  .strict();

/**
 * home.getRowContent input: rowId (opaque registry slug) + cursor (null = first page, otherwise server-internal decoded).
 * rowId is not validated by wire enum since multiple rows can share RowKind (e.g. recommendedForYou-tv, recommendedForYou-movies).
 */
export const homeGetRowContentInputSchema = z
  .object({
    rowId: z.string().min(1),
    cursor: z.string().nullable(),
  })
  .strict();

/**
 * `home.getDetails` input: tmdb id + media type (the only fields needed to
 * key both the catalog read and the dispatch-cached `metadata@v1.getDetails`
 * call).
 */
export const homeGetDetailsInputSchema = z
  .object({
    tmdbId: z.string().min(1),
    mediaType: mediaTypeSchema,
  })
  .strict();

/**
 * `home.getSeasonAvailability` input: tmdb id of the show. Per-server presence
 * is the only thing the route returns — canonical seasons ride on
 * `home.getDetails` (different cache TTL).
 */
export const homeGetSeasonAvailabilityInputSchema = z
  .object({
    tmdbId: z.string().min(1),
  })
  .strict();

export type HomeGetLayoutInput = z.infer<typeof homeGetLayoutInputSchema>;
export type HomeGetRowContentInput = z.infer<typeof homeGetRowContentInputSchema>;
export type HomeGetDetailsInput = z.infer<typeof homeGetDetailsInputSchema>;
export type HomeGetSeasonAvailabilityInput = z.infer<typeof homeGetSeasonAvailabilityInputSchema>;
