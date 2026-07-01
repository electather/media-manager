import { z } from "zod";

/**
 * Media-item "type" returned by media-server plugins. Episodes are distinct
 * from the parent show so a `continueWatching` row can carry both (`item` is
 * an episode, `nextUp` may be the next episode).
 */
export const LIBRARY_ITEM_TYPES = ["movie", "show", "episode"] as const;
export type LibraryItemType = (typeof LIBRARY_ITEM_TYPES)[number];

/**
 * Query types for `libraryAvailability@v1` / `continueWatching@v1`. Subset of
 * `LIBRARY_ITEM_TYPES` (episode is output-only). Keeps input/output vocab
 * consistent instead of adopting cross-service "movie" | "tv" convention.
 */
export const LIBRARY_ITEM_QUERY_TYPES = ["movie", "show"] as const;
export type LibraryItemQueryType = (typeof LIBRARY_ITEM_QUERY_TYPES)[number];

export const LIBRARY_ITEM_RESOLUTIONS = ["4k", "1080p", "720p", "sd"] as const;
export type LibraryItemResolution = (typeof LIBRARY_ITEM_RESOLUTIONS)[number];

export const LIBRARY_ITEM_HDR_FORMATS = ["hdr10", "dolby-vision", "hlg", "none"] as const;
export type LibraryItemHdrFormat = (typeof LIBRARY_ITEM_HDR_FORMATS)[number];

/**
 * Technical quality details about a specific library copy. All fields are
 * optional because different servers expose different subsets — callers
 * should treat missing fields as "unknown", not "absent".
 */
export const libraryItemQualitySchema = z.object({
  resolution: z.enum(LIBRARY_ITEM_RESOLUTIONS).optional(),
  codec: z.string().optional(),
  hdr: z.enum(LIBRARY_ITEM_HDR_FORMATS).optional(),
  /** Bitrate in kbps. */
  bitrate: z.number().optional(),
});
export type LibraryItemQuality = z.infer<typeof libraryItemQualitySchema>;

/**
 * Item on user's media server (libraryAvailability@v1, continueWatching@v1,
 * playbackSessions@v1, libraryAdmin@v1). `id` is server-local (Plex ratingKey,
 * Jellyfin itemId). `playerLink` and `webLink` must use external server URL so
 * caller can resolve on their device; see docs/2026-04-19-plugin-architecture-design.md.
 */
export const libraryItemSchema = z.object({
  /** Server-local id. Used by subsequent calls back to the same server. */
  id: z.string().min(1),
  title: z.string(),
  type: z.enum(LIBRARY_ITEM_TYPES),
  /** Season number for episodes. */
  season: z.number().optional(),
  /** Episode number for episodes. */
  episode: z.number().optional(),
  quality: libraryItemQualitySchema.default({}),
  /**
   * Deep link that opens the native client on the caller's device (e.g.
   * `plex://…`, `jellyfin://…`). Built from the connection's external URL.
   */
  playerLink: z.string(),
  /** Optional https link to the server's web UI. Also external-only. */
  webLink: z.string().optional(),
  sizeBytes: z.number().optional(),
  durationSec: z.number().optional(),
  /** ISO timestamp the server imported the item. */
  addedAt: z.string(),
  /**
   * Cross-service ids (tmdb, imdb, tvdb) plus server-local (jellyfin:itemId,
   * plex:ratingKey). Lets downstreams re-key against TMDB or other sources.
   * Optional for plugins with no provider-id metadata.
   */
  ids: z.record(z.string(), z.string()).optional(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;
