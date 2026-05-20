import { z } from "zod";
import { MEDIA_TYPES } from "../media/enums";
import { WATCHLIST_USER_SOURCES } from "./enums";

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
