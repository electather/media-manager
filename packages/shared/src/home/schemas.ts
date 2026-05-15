import { z } from "zod";
import { AVAILABILITY_STATUSES, MEDIA_TYPES } from "../media/enums";
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
 * Wire-format media item shipped across home rows and the global command-menu
 * search endpoint. Mirrors the `CompactMediaItem` interface in `./types`;
 * absent fields are omitted (not null) so consumers stay happy with
 * `z.optional()` rather than `z.nullable()`.
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
  })
  .strict();

/**
 * `home.getRowContent` input: client supplies a row id and the opaque cursor
 * from the previous page. Null cursor means first page. Decoding/validating
 * the cursor itself is server-internal and lives outside `@ent-mcp/shared`.
 *
 * `rowId` is an opaque registry slug — multiple rows can share the same
 * `RowKind` (e.g. `recommendedForYou-tv` and `recommendedForYou-movies`),
 * so the wire enum cannot validate it.
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
