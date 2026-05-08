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
  id: z.string(),
  seasons: z.string().optional(),
});
export type CreateMediaRequestBody = z.infer<typeof createMediaRequestSchema>;
