import { z } from "zod";

/**
 * Media-item "type" returned by media-server plugins. Episodes are distinct
 * from the parent show so a `continueWatching` row can carry both (`item` is
 * an episode, `nextUp` may be the next episode).
 */
export const LIBRARY_ITEM_TYPES = ["movie", "show", "episode"] as const;
export type LibraryItemType = (typeof LIBRARY_ITEM_TYPES)[number];

/**
 * Title-level kinds callers query against `libraryAvailability@v1` /
 * `continueWatching@v1`. A proper subset of `LIBRARY_ITEM_TYPES` — `"episode"`
 * is an output-only granularity and is not a meaningful query target on its
 * own (callers narrow by movie vs. show). Using this on inputs instead of the
 * cross-service `"movie" | "tv"` convention keeps the input/output vocabulary
 * consistent within the media-server capabilities.
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
 * Shared "an item that exists on a user's media server" shape. Returned by
 * `libraryAvailability@v1`, nested inside `continueWatching@v1`, and reused
 * later by `playbackSessions@v1` and `libraryAdmin@v1`.
 *
 * `id` is server-local (e.g. Plex ratingKey, Jellyfin itemId) — meaningful
 * only against the same connection that produced it. `playerLink` and
 * `webLink` must be built from the connection's external server URL so they
 * resolve on the caller's device; see the "Self-hosted network topology"
 * section in `docs/2026-04-19-plugin-architecture-design.md`.
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
   * Cross-service ids that let downstream consumers (catalog metadata
   * lookups, status batching, request flows) re-key this title against TMDB
   * or another non-server source. Plugins populate the keys they know
   * (`tmdb`, `imdb`, `tvdb`) plus their own server-local id (e.g.
   * `jellyfin:itemId`, `plex:ratingKey`). Optional so plugins that have no
   * provider-id metadata can still emit valid items.
   */
  ids: z.record(z.string(), z.string()).optional(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;
