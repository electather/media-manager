import { z } from "zod";
import { MEDIA_TYPES } from "../media/enums";
import { WATCHLIST_LIST_FILTERS, WATCHLIST_USER_SOURCES } from "./enums";

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

export const watchlistListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(WATCHLIST_LIST_MAX_LIMIT)
      .default(WATCHLIST_LIST_DEFAULT_LIMIT),
    filter: z.enum(WATCHLIST_LIST_FILTERS).optional(),
  })
  .strict();
export type WatchlistListQueryInput = z.input<typeof watchlistListQuerySchema>;
export type WatchlistListQueryParsed = z.infer<typeof watchlistListQuerySchema>;
