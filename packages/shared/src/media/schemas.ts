import { z } from "zod";
import { compactMediaItemSchema } from "../home/schemas";
import { AVAILABILITY_STATUSES, MEDIA_TYPES } from "./enums";

export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export const availabilityStatusSchema = z.enum(AVAILABILITY_STATUSES);

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

/**
 * Response shape for `GET /api/discover/trending`. Reuses the wire
 * `CompactMediaItem` so the command menu shares its row component with
 * the home feed.
 */
export const discoverTrendingResponseSchema = z
  .object({
    results: z.array(compactMediaItemSchema),
    hasMore: z.boolean(),
  })
  .strict();
export type DiscoverTrendingResponse = z.infer<typeof discoverTrendingResponseSchema>;

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
  tmdbId: z.string().min(1),
  mediaType: mediaTypeSchema,
  serviceId: z.string().min(1),
  profileId: z.string().nullable().optional(),
  seasons: z.array(z.number().int().positive()).optional(),
});
export type CreateMediaRequestBody = z.infer<typeof createMediaRequestSchema>;

/** Response for `POST /api/requests`. */
export const createMediaRequestResponseSchema = z.object({
  requestId: z.string().nullable(),
});
export type CreateMediaRequestResponse = z.infer<typeof createMediaRequestResponseSchema>;

/** One quality profile entry exposed by a request target. */
export const requestProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().optional(),
});
export type RequestProfile = z.infer<typeof requestProfileSchema>;

/**
 * One entry in `GET /api/requests/targets`. `serviceId` is host-encoded
 * `${connectionId}:${pluginTargetId}` and treated as opaque by the client.
 */
export const requestTargetSchema = z.object({
  serviceId: z.string(),
  pluginId: z.string(),
  label: z.string(),
  exposesProfiles: z.boolean(),
  defaultProfileId: z.string().nullable(),
  profiles: z.array(requestProfileSchema),
});
export type RequestTarget = z.infer<typeof requestTargetSchema>;

/** Response shape for `GET /api/requests/targets`. */
export const requestTargetsResponseSchema = z.object({
  targets: z.array(requestTargetSchema),
});
export type RequestTargetsResponse = z.infer<typeof requestTargetsResponseSchema>;

/** Query for `GET /api/requests/targets`. */
export const requestTargetsQuerySchema = z.object({
  mediaType: mediaTypeSchema,
});
export type RequestTargetsQuery = z.infer<typeof requestTargetsQuerySchema>;
