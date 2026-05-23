import { z } from "zod";
import { MEDIA_TYPES } from "../media/enums";
import { MOOD_IDS, WATCHLIST_BUCKETS, WATCHLIST_SORTS, WATCHLIST_USER_SOURCES } from "./enums";

const tmdbIdSchema = z.string().regex(/^\d+$/u, "tmdbId must be a numeric string");

export const watchlistParamSchema = z
  .object({
    tmdbId: tmdbIdSchema,
    mediaType: z.enum(MEDIA_TYPES),
  })
  .strict();
export type WatchlistParam = z.infer<typeof watchlistParamSchema>;

export const addWatchlistRequestSchema = z
  .object({
    tmdbId: tmdbIdSchema,
    mediaType: z.enum(MEDIA_TYPES),
    source: z.enum(WATCHLIST_USER_SOURCES).default("manual"),
  })
  .strict();
export type AddWatchlistRequestInput = z.input<typeof addWatchlistRequestSchema>;
export type AddWatchlistRequestParsed = z.infer<typeof addWatchlistRequestSchema>;

export const WATCHLIST_LIST_DEFAULT_LIMIT = 60;
export const WATCHLIST_LIST_MAX_LIMIT = 200;

const RECENTLY_DEFAULT_LIMIT = 5;
const RECENTLY_MAX_LIMIT = 20;

/** `GET /api/watchlist/items` query. */
export const itemsQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(WATCHLIST_LIST_MAX_LIMIT)
      .default(WATCHLIST_LIST_DEFAULT_LIMIT),
    sort: z.enum(WATCHLIST_SORTS).default("recent"),
    bucket: z.enum(WATCHLIST_BUCKETS).optional(),
    mood: z.enum(MOOD_IDS).optional(),
  })
  .strict();
export type ItemsQueryInput = z.input<typeof itemsQuerySchema>;
export type ItemsQueryParsed = z.infer<typeof itemsQuerySchema>;

/** `GET /api/watchlist/sections/recently` query. */
export const recentlyQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(RECENTLY_MAX_LIMIT).default(RECENTLY_DEFAULT_LIMIT),
  })
  .strict();
export type RecentlyQueryInput = z.input<typeof recentlyQuerySchema>;
export type RecentlyQueryParsed = z.infer<typeof recentlyQuerySchema>;

/** `GET /api/watchlist/moods/:moodId` path param. */
export const moodParamSchema = z
  .object({
    moodId: z.enum(MOOD_IDS),
  })
  .strict();
export type MoodParamParsed = z.infer<typeof moodParamSchema>;

/** `GET /api/watchlist/moods/:moodId/items` query. */
export const moodItemsQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(WATCHLIST_LIST_MAX_LIMIT)
      .default(WATCHLIST_LIST_DEFAULT_LIMIT),
  })
  .strict();
export type MoodItemsQueryInput = z.input<typeof moodItemsQuerySchema>;
export type MoodItemsQueryParsed = z.infer<typeof moodItemsQuerySchema>;
