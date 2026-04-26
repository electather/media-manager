import { z } from "zod";
import { libraryItemSchema, LIBRARY_ITEM_QUERY_TYPES } from "@ent-mcp/shared/plugins/library";
import { defineCapability, method } from "../define";

const mediaType = z.enum(["movie", "tv"]);

// Cross-service ids carried on every `MediaItemShape`. Intentionally omits
// server-local ids like `plex:ratingKey` and `jellyfin:itemId`: those are
// resolution artifacts (a single media item lives on many Plex/Jellyfin
// servers with different local ids per server) and are returned by
// `idResolve@v1` for routing, not attached to media items.
const idBundle = z
  .object({
    tmdb_id: z.string().optional(),
    imdb_id: z.string().optional(),
    tvdb_id: z.string().optional(),
    trakt_id: z.string().optional(),
    trakt_slug: z.string().optional(),
  })
  .default({});

const mediaItem = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  type: mediaType,
  genres: z.array(z.string()).default([]),
  rating: z.number().nullable(),
  overview: z.string().default(""),
  posterUrl: z.string().nullable(),
  ids: idBundle,
  runtime: z.number().nullable().optional(),
  originalLanguage: z.string().nullable().optional(),
  cast: z.array(z.string()).optional(),
  director: z.string().nullable().optional(),
  writers: z.array(z.string()).optional(),
  creators: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
});

export type MediaItemShape = z.infer<typeof mediaItem>;

const historyEntry = z.object({
  item: mediaItem,
  watchedAt: z.string(),
  progress: z.number().nullable().optional(),
  rewatchCount: z.number().optional(),
});

const watchlistEntry = z.object({
  item: mediaItem,
  addedAt: z.string(),
});

const commentEntry = z.object({
  item: mediaItem,
  text: z.string(),
  createdAt: z.string(),
});

const ratingEntry = z.object({
  item: mediaItem,
  rating: z.number().min(0).max(10),
  ratedAt: z.string(),
});

const upcoming = z.object({
  item: mediaItem,
  season: z.number().optional(),
  episode: z.number().optional(),
  episodeTitle: z.string().optional(),
  airsAt: z.string(),
});

const collectionEntry = z.object({
  item: mediaItem,
  addedAt: z.string(),
});

const playbackPosition = z.object({
  item: mediaItem,
  progress: z.number().min(0).max(100),
  pausedAt: z.string(),
  season: z.number().optional(),
  episode: z.number().optional(),
  playbackId: z.string(),
});

const videoEntry = z.object({
  kind: z.enum(["trailer", "teaser", "clip", "featurette", "other"]),
  site: z.string(),
  key: z.string(),
  // Null for sites we don't know how to build a URL for — the raw `key` and
  // `site` are still available for callers that recognise other providers.
  url: z.string().nullable(),
  official: z.boolean().optional(),
});

const watchProviders = z.object({
  streaming: z.array(z.string()).default([]),
  rent: z.array(z.string()).default([]),
  buy: z.array(z.string()).default([]),
});

const searchResult = z.object({
  item: mediaItem,
  score: z.number().optional(),
});

const discoverFilters = z.object({
  genres: z.array(z.string()).optional(),
  yearMin: z.number().optional(),
  yearMax: z.number().optional(),
  ratingMin: z.number().optional(),
  limit: z.number().optional(),
});

/**
 * Id kinds accepted by `idResolve@v1`.
 *
 * Cross-service ids (`tmdb`, `tvdb`, `trakt`, `imdb`) are globally meaningful
 * and typically resolved by global plugins. Server-local ids
 * (`plex:ratingKey`, `jellyfin:itemId`) belong to a specific user's media
 * server and are only resolvable by user-scoped plugins with access to that
 * server.
 */
const idKinds = z.enum(["tmdb", "tvdb", "trakt", "imdb", "plex:ratingKey", "jellyfin:itemId"]);

export type IdResolveKind = z.infer<typeof idKinds>;

const idResolveInput = z.object({
  from: idKinds,
  id: z.string(),
  type: mediaType,
});

const idResolveOutput = z.object({
  tmdb: z.string().optional(),
  tvdb: z.string().optional(),
  trakt: z.string().optional(),
  imdb: z.string().optional(),
  "plex:ratingKey": z.string().optional(),
  "jellyfin:itemId": z.string().optional(),
});

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * metadata@v1 — primary_with_enrichment. User picks a primary per media type;
 * other plugins fill fields where the primary returned null/missing.
 */
export const MetadataV1 = defineCapability({
  id: "metadata",
  version: "v1",
  strategy: "primary_with_enrichment",
  scope: "global",
  defaultCacheTtlSec: DAY,
  negativeCacheTtlSec: 5 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    search: method(
      z.object({ query: z.string(), type: mediaType.optional(), limit: z.number().optional() }),
      z.array(searchResult),
    ),
    getDetails: method(z.object({ id: z.string(), type: mediaType }), mediaItem),
    getSimilar: method(z.object({ id: z.string(), type: mediaType }), z.array(mediaItem)),
    getTrending: method(
      z.object({ type: mediaType.optional(), limit: z.number().optional() }),
      z.array(mediaItem),
    ),
    discover: method(discoverFilters, z.array(mediaItem)),
  },
  mcpTools: [
    {
      name: "ent_details",
      description:
        "Get enriched details for a specific movie or TV show including metadata, cast, ratings, availability, and your watch status.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "TMDB ID prefixed with type, e.g. 'movie:550' or 'tv:1396'",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          type: { type: "string", enum: ["movie", "tv"] },
          year: { type: "integer" },
          genres: { type: "array", items: { type: "string" } },
          overview: { type: "string" },
          poster: { type: "string" },
          status: {
            type: "string",
            enum: ["available", "requested", "processing", "unavailable", "unknown"],
          },
          user_rated: { type: "integer" },
          cast: { type: "array", items: { type: "string" } },
          keywords: { type: "array", items: { type: "string" } },
          runtime: { type: "integer" },
          director: { type: "string" },
          streaming: { type: "array", items: { type: "string" } },
          trailer: { type: "string" },
          ratings: { type: "object", additionalProperties: { type: "number" } },
          watch_progress: { type: ["object", "null"] },
        },
        required: ["id", "title", "type"],
        additionalProperties: false,
      },
      requiredScopes: ["mcp.read"],
      annotations: { readOnlyHint: true },
      handlerKey: "ent_details",
    },
  ],
});

export const WatchHistoryV1 = defineCapability({
  id: "watchHistory",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getHistory: method(
      z.object({ limit: z.number().optional(), since: z.string().optional() }),
      z.array(historyEntry),
    ),
    addToHistory: method(z.array(mediaItem), z.object({ added: z.number() }), {
      invalidates: ["watchHistory@v1"],
    }),
    removeFromHistory: method(z.array(mediaItem), z.object({ removed: z.number() }), {
      invalidates: ["watchHistory@v1"],
    }),
  },
});

export const WatchlistV1 = defineCapability({
  id: "watchlist",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getWatchlist: method(z.object({ type: mediaType.optional() }), z.array(watchlistEntry)),
    addToWatchlist: method(z.array(mediaItem), z.object({ added: z.number() }), {
      invalidates: ["watchlist@v1"],
    }),
    removeFromWatchlist: method(z.array(mediaItem), z.object({ removed: z.number() }), {
      invalidates: ["watchlist@v1"],
    }),
  },
});

export const RatingsV1 = defineCapability({
  id: "ratings",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 15 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getRatings: method(z.object({ type: mediaType.optional() }), z.array(ratingEntry)),
    setRating: method(
      z.object({ item: mediaItem, rating: z.number().min(0).max(10) }),
      z.object({ ok: z.boolean() }),
      { invalidates: ["ratings@v1"] },
    ),
    removeRating: method(z.object({ item: mediaItem }), z.object({ ok: z.boolean() }), {
      invalidates: ["ratings@v1"],
    }),
  },
});

export const RecommendationsV1 = defineCapability({
  id: "recommendations",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 6 * HOUR,
  negativeCacheTtlSec: 5 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getRecommendations: method(
      z.object({ type: mediaType.optional(), limit: z.number().optional() }),
      z.array(mediaItem),
    ),
    getTrending: method(
      z.object({ type: mediaType.optional(), limit: z.number().optional() }),
      z.array(mediaItem),
    ),
    getAnticipated: method(
      z.object({ type: mediaType.optional(), limit: z.number().optional() }),
      z.array(mediaItem),
    ),
  },
});

export const CalendarV1 = defineCapability({
  id: "calendar",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: HOUR,
  negativeCacheTtlSec: 5 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getUpcoming: method(z.object({ days: z.number().optional() }), z.array(upcoming)),
    getUpcomingMovies: method(z.object({ days: z.number().optional() }), z.array(upcoming)),
  },
});

export const MediaRequestV1 = defineCapability({
  id: "mediaRequest",
  version: "v1",
  strategy: "single",
  scope: "user",
  defaultCacheTtlSec: 1 * MIN,
  negativeCacheTtlSec: 30,
  defaultTimeoutMs: 15_000,
  methods: {
    checkAvailability: method(
      z.object({ tmdbId: z.string(), type: mediaType }),
      z.object({
        status: z.enum(["available", "requested", "processing", "unavailable", "unknown"]),
      }),
    ),
    createRequest: method(
      z.object({ tmdbId: z.string(), type: mediaType, seasons: z.string().optional() }),
      z.object({
        success: z.boolean(),
        requestId: z.string().optional(),
        message: z.string().optional(),
      }),
      { invalidates: ["mediaRequest@v1"] },
    ),
    listRequests: method(
      z.object({}),
      z.array(
        z.object({
          id: z.string(),
          tmdbId: z.string(),
          type: mediaType,
          title: z.string(),
          status: z.enum(["pending", "approved", "processing", "available", "failed"]),
          createdAt: z.string(),
        }),
      ),
    ),
    cancelRequest: method(
      z.object({ requestId: z.string() }),
      z.object({ ok: z.boolean(), message: z.string().optional() }),
      { invalidates: ["mediaRequest@v1"] },
    ),
  },
  mcpTools: [
    {
      name: "ent_request",
      description: "Request a movie or TV show download, or check status of existing requests.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "status"],
            default: "status",
          },
          id: {
            type: "string",
            description:
              "TMDB ID prefixed with type, e.g. 'movie:550'. Required when action=create.",
          },
          seasons: {
            type: "string",
            description: "For TV: 'all', 'latest', or comma-separated like '1,2,3'",
          },
          target: {
            type: "string",
            description:
              "Connection ID when you have multiple request providers. Omit to use default.",
          },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "status"] },
          target: {
            type: "object",
            properties: {
              connection_id: { type: "string" },
              display_name: { type: ["string", "null"] },
            },
            required: ["connection_id", "display_name"],
            additionalProperties: false,
          },
          success: { type: "boolean" },
          request_id: { type: "string" },
          message: { type: "string" },
          requests: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tmdb_id: { type: "string" },
                type: { type: "string", enum: ["movie", "tv"] },
                title: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "approved", "processing", "available", "failed"],
                },
                created_at: { type: "string" },
                connection_id: { type: "string" },
              },
              required: ["id", "tmdb_id", "type", "title", "status", "created_at", "connection_id"],
              additionalProperties: false,
            },
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      requiredScopes: ["mcp.write.request"],
      annotations: { destructiveHint: false, idempotentHint: false },
      handlerKey: "ent_request",
    },
  ],
});

/**
 * Internal-only capability: not invoked directly by callers — only by
 * MediaService id_map gap-fill.
 *
 * **Mixed-scope.** Global plugins (Trakt/TMDB/TVDB) own cross-service id
 * resolution; user-scoped plugins (Plex/Jellyfin) own server-local ids
 * (`plex:ratingKey`, `jellyfin:itemId`). `scopeForInput` classifies the
 * request by the `from` field: values containing `:` are server-local and
 * route to user-scoped providers; flat id kinds (`tmdb`, `tvdb`, `trakt`,
 * `imdb`) route globally. The dispatcher uses this classification for both
 * provider lookup and cache keying, so a server-local resolution done for
 * user A cannot be served back to user B from the global cache.
 */
export const IdResolveV1 = defineCapability({
  id: "idResolve",
  version: "v1",
  strategy: "single",
  scope: "mixed",
  scopeForInput: (input: unknown) => {
    // `from` is validated by `idResolveInput` before this runs (see
    // `strategy` pipeline), so the type assertion is safe for well-formed
    // requests. Defensive `typeof` guard for edge cases where validation
    // has been bypassed (e.g. direct dispatcher calls from tests).
    //
    // Classifier rule: server-local id kinds are the ones that contain
    // `":"` (`plex:ratingKey`, `jellyfin:itemId`). Cross-service id kinds
    // (`tmdb`, `imdb`, `tvdb`, `trakt`) are flat — no colon — and route
    // globally. Because `idResolveInput` uses `z.enum`, adding a new
    // colon-bearing global id kind later would require an explicit code
    // change here, not a silent classification flip.
    const from = (input as { from?: unknown } | null)?.from;
    return typeof from === "string" && from.includes(":") ? "user" : "global";
  },
  defaultCacheTtlSec: 7 * DAY,
  negativeCacheTtlSec: HOUR,
  defaultTimeoutMs: 10_000,
  methods: {
    resolve: method(idResolveInput, idResolveOutput),
  },
});

export const UserCommentsV1 = defineCapability({
  id: "userComments",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 15 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getComments: method(z.object({ limit: z.number().optional() }), z.array(commentEntry)),
  },
});

/**
 * watchProviders@v1 — streaming/rent/buy availability per media item per region.
 * Provider-name arrays only; does not carry deep links.
 *
 * `region` is an ISO 3166-1 alpha-2 country code. When omitted, plugins fall
 * back to "US" — callers that need different geography should pass the code
 * explicitly.
 */
export const WatchProvidersV1 = defineCapability({
  id: "watchProviders",
  version: "v1",
  strategy: "single",
  scope: "global",
  defaultCacheTtlSec: DAY,
  negativeCacheTtlSec: HOUR,
  defaultTimeoutMs: 10_000,
  methods: {
    getProviders: method(
      z.object({
        id: z.string(),
        type: mediaType,
        // ISO 3166-1 alpha-2; plugins default to "US" when omitted.
        region: z.string().optional(),
      }),
      watchProviders,
    ),
  },
});

/** trailers@v1 — trailer/teaser/clip videos per media item. */
export const TrailersV1 = defineCapability({
  id: "trailers",
  version: "v1",
  strategy: "single",
  scope: "global",
  defaultCacheTtlSec: DAY,
  negativeCacheTtlSec: HOUR,
  defaultTimeoutMs: 10_000,
  methods: {
    getVideos: method(z.object({ id: z.string(), type: mediaType }), z.array(videoEntry)),
  },
});

/** playback@v1 — cross-device resume positions. */
export const PlaybackV1 = defineCapability({
  id: "playback",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 1 * MIN,
  negativeCacheTtlSec: 30,
  defaultTimeoutMs: 15_000,
  methods: {
    getPositions: method(z.object({ type: mediaType.optional() }), z.array(playbackPosition)),
    removePosition: method(z.object({ playbackId: z.string() }), z.object({ ok: z.boolean() }), {
      invalidates: ["playback@v1"],
    }),
  },
});

// ─── libraryAvailability@v1 shared shapes ────────────────────────────────────

/**
 * Id-type accepted by `libraryAvailability@v1.checkAvailability`. Covers the
 * cross-service ids media-server plugins can look up (`tmdb`, `imdb`, `tvdb`)
 * plus their own server-local ids so a caller holding e.g. a Plex ratingKey
 * can skip the resolve step.
 */
const libraryAvailabilityIdType = z.enum(["tmdb", "imdb", "tvdb", "plex", "jellyfin"]);

// Inputs across libraryAvailability@v1 / continueWatching@v1 use
// LIBRARY_ITEM_QUERY_TYPES (`"movie" | "show"`) rather than the cross-service
// `mediaType` ("movie" | "tv") so the input vocabulary matches the
// LIBRARY_ITEM_TYPES the output schema uses. Episodes are an output-only
// granularity — callers filter at the title level.
const libraryItemQueryType = z.enum(LIBRARY_ITEM_QUERY_TYPES);

const libraryAvailabilityCheckInput = z.object({
  /** Identifier value; its flavour is tagged by `idType`. */
  id: z.string().min(1),
  idType: libraryAvailabilityIdType,
  type: libraryItemQueryType,
});

const libraryAvailabilityCheckOutput = z.object({
  /**
   * Zero or more matches — multiple quality copies of the same title (e.g. 4k
   * HDR alongside 1080p SDR) each surface as their own entry so callers can
   * pick the right one to play.
   */
  items: z.array(libraryItemSchema),
});

const libraryAvailabilityRecentlyAddedInput = z.object({
  type: libraryItemQueryType.optional(),
  /** Page size; plugins clamp server-side to a sensible max. */
  limit: z.number().optional(),
  /** Opaque cursor returned by the previous page, or omitted for the first page. */
  cursor: z.string().optional(),
});

const libraryAvailabilityRecentlyAddedOutput = z.object({
  items: z.array(libraryItemSchema),
  /** Opaque cursor for the next page; absent when there is no next page. */
  nextCursor: z.string().optional(),
});

const libraryAvailabilitySearchInput = z.object({
  query: z.string().min(1),
  type: libraryItemQueryType.optional(),
  limit: z.number().optional(),
});

/**
 * libraryAvailability@v1 — does the user's self-hosted media server (Plex,
 * Jellyfin, …) have this item, and what's new on it? See the design doc's
 * "New capability contracts" section for backing endpoints and rationale.
 *
 * No `mcpTools` in this revision — they will land alongside the Plex/Jellyfin
 * plugin implementations (#22, #23) so the tool surface can reference real
 * backing methods rather than stubs.
 */
export const LibraryAvailabilityV1 = defineCapability({
  id: "libraryAvailability",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    checkAvailability: method(libraryAvailabilityCheckInput, libraryAvailabilityCheckOutput),
    listRecentlyAdded: method(
      libraryAvailabilityRecentlyAddedInput,
      libraryAvailabilityRecentlyAddedOutput,
    ),
    searchLibrary: method(libraryAvailabilitySearchInput, z.array(libraryItemSchema)),
  },
});

// ─── continueWatching@v1 shared shapes ───────────────────────────────────────

const continueWatchingInput = z.object({
  type: libraryItemQueryType.optional(),
  limit: z.number().optional(),
});

const continueWatchingEntry = z.object({
  /** The thing to resume or start — an episode for shows, a movie for movies. */
  item: libraryItemSchema,
  /**
   * Progress into `item` in milliseconds. Absent when this is a "start next
   * episode" entry with no prior position on the server.
   */
  progressMs: z.number().optional(),
  /** For TV: the episode after `item` when the server surfaces one. */
  nextUp: libraryItemSchema.optional(),
  /** ISO timestamp of the most recent playback on `item`, for cross-feed sort. */
  lastPlayedAt: z.string().optional(),
});

export type ContinueWatchingEntry = z.infer<typeof continueWatchingEntry>;

/**
 * continueWatching@v1 — the server's own "pick up where you left off" feed,
 * including Next Up episode stitching. Distinct from `playback@v1`, which
 * returns raw resume points from external sync APIs (Trakt) rather than a
 * server-curated ranking. Reuses `LibraryItem` so sessions and continue feeds
 * nest the same media shape.
 *
 * No `mcpTools` in this revision — they land with the Plex/Jellyfin plugin
 * implementations (#22, #23).
 */
export const ContinueWatchingV1 = defineCapability({
  id: "continueWatching",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getContinueWatching: method(continueWatchingInput, z.array(continueWatchingEntry)),
  },
});

// ─── playbackSessions@v1 shared shapes ───────────────────────────────────────

const sessionTranscodingDecision = z.enum(["direct-play", "copy", "transcode"]);

const sessionState = z.enum(["playing", "paused", "buffering"]);

const sessionTranscoding = z.object({
  videoDecision: sessionTranscodingDecision,
  audioDecision: sessionTranscodingDecision,
  /** Target bitrate in kbps when the server is transcoding. */
  targetBitrate: z.number().optional(),
  /** Server-reported reason for the transcode (e.g. "audio codec mismatch"). */
  reason: z.string().optional(),
});

// Server-local user identity. Distinct from the media-manager user running the
// query — a Plex home-user or a Jellyfin managed user may be the one actually
// playing, even though the connection is authed as the owning account. Plugins
// MUST only return sessions for users the connection is allowed to see and
// MUST drop sessions from other accounts even when the underlying token could
// see them (see design doc for per-server filtering rules).
const sessionUser = z.object({
  id: z.string(),
  name: z.string(),
});

const sessionEntry = z.object({
  sessionId: z.string().min(1),
  deviceName: z.string(),
  /** e.g. "Plex for iOS", "Jellyfin Web"; absent when the server does not expose it. */
  clientName: z.string().optional(),
  user: sessionUser,
  item: libraryItemSchema,
  progressMs: z.number(),
  durationMs: z.number(),
  state: sessionState,
  transcoding: sessionTranscoding.optional(),
  /** ISO timestamp playback started on this session. */
  startedAt: z.string(),
});

export type SessionEntry = z.infer<typeof sessionEntry>;

const getSessionsInput = z.object({});

const stopSessionInput = z.object({
  sessionId: z.string().min(1),
  /** Optional human-readable reason surfaced to the player (Jellyfin only). */
  reason: z.string().optional(),
});

// "forced" — Plex terminates server-side and the session disappears on next
// getSessions. "requested" — Jellyfin sends a remote-control command that the
// client may ignore if offline/unresponsive. UIs should phrase the
// confirmation accordingly instead of assuming an immediate hard stop.
const stopSessionSemantics = z.enum(["forced", "requested"]);

const stopSessionOutput = z.object({
  ok: z.boolean(),
  semantics: stopSessionSemantics,
});

/**
 * playbackSessions@v1 — currently-playing sessions across the user's media
 * servers, plus a per-session stop action. Transcoding details ride inline on
 * each session so a dedicated `transcoding@v1` capability is unnecessary.
 *
 * Distinct from `playback@v1`, which returns historical resume positions from
 * sync APIs (Trakt). Sessions here are live, server-observed, and short-lived.
 *
 * No `mcpTools` in this revision — they land with the Plex/Jellyfin plugin
 * implementations (#22, #23).
 */
export const PlaybackSessionsV1 = defineCapability({
  id: "playbackSessions",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 30,
  negativeCacheTtlSec: 15,
  defaultTimeoutMs: 15_000,
  methods: {
    getSessions: method(getSessionsInput, z.array(sessionEntry)),
    stopSession: method(stopSessionInput, stopSessionOutput, {
      invalidates: ["playbackSessions@v1"],
    }),
  },
});

// ─── libraryAdmin@v1 shared shapes ───────────────────────────────────────────

const refreshLibraryInput = z.object({
  /**
   * Server-local section id. When omitted, the plugin refreshes all sections
   * it can see (Plex: iterates sections with force=1; Jellyfin: hits the
   * server-wide `/Library/Refresh`).
   */
  librarySectionId: z.string().optional(),
});

const refreshItemInput = z.object({
  /** Server-local item id (Plex ratingKey, Jellyfin itemId). */
  serverItemId: z.string().min(1),
});

// Both operations are fire-and-forget: the backing endpoints return empty
// bodies with no scan id or progress handle, so the contract is only "the
// server accepted the request". Intentionally no `invalidates` — invalidating
// libraryAvailability@v1 here would surface stale re-fetches until the scan
// actually completes server-side, which can take seconds to minutes. Hosts
// that need to force a fresh read after a refresh should do so explicitly.
const refreshOutput = z.object({ ok: z.boolean() });

/**
 * libraryAdmin@v1 — trigger server-side rescan / metadata refresh on demand.
 * Intended caller is the host itself, invoked after a successful
 * `mediaRequest@v1` fulfilment so the new file lands in the library without
 * waiting on the periodic scan. That host wiring is tracked as a follow-up
 * (see issue #21) — this packet only declares the capability contract.
 *
 * No `mcpTools` in this revision — they land with the Plex/Jellyfin plugin
 * implementations (#22, #23).
 */
export const LibraryAdminV1 = defineCapability({
  id: "libraryAdmin",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 30,
  negativeCacheTtlSec: 15,
  defaultTimeoutMs: 30_000,
  methods: {
    refreshLibrary: method(refreshLibraryInput, refreshOutput),
    refreshItem: method(refreshItemInput, refreshOutput),
  },
});

/** collection@v1 — user's owned/collected library. */
export const CollectionV1 = defineCapability({
  id: "collection",
  version: "v1",
  strategy: "aggregate",
  scope: "user",
  defaultCacheTtlSec: 15 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getCollection: method(z.object({ type: mediaType.optional() }), z.array(collectionEntry)),
    addToCollection: method(z.array(mediaItem), z.object({ added: z.number() }), {
      invalidates: ["collection@v1"],
    }),
    removeFromCollection: method(z.array(mediaItem), z.object({ removed: z.number() }), {
      invalidates: ["collection@v1"],
    }),
  },
});

/**
 * Host-side registry of known capabilities. Indexed by `${id}@${version}`.
 */
export const CAPABILITY_CATALOG = {
  "metadata@v1": MetadataV1,
  "watchHistory@v1": WatchHistoryV1,
  "watchlist@v1": WatchlistV1,
  "ratings@v1": RatingsV1,
  "recommendations@v1": RecommendationsV1,
  "calendar@v1": CalendarV1,
  "mediaRequest@v1": MediaRequestV1,
  "idResolve@v1": IdResolveV1,
  "userComments@v1": UserCommentsV1,
  "watchProviders@v1": WatchProvidersV1,
  "trailers@v1": TrailersV1,
  "playback@v1": PlaybackV1,
  "collection@v1": CollectionV1,
  "libraryAvailability@v1": LibraryAvailabilityV1,
  "continueWatching@v1": ContinueWatchingV1,
  "playbackSessions@v1": PlaybackSessionsV1,
  "libraryAdmin@v1": LibraryAdminV1,
} as const;

export type CapabilityKey = keyof typeof CAPABILITY_CATALOG;

export function capabilityKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export function getCapability(
  id: string,
  version: string,
): (typeof CAPABILITY_CATALOG)[CapabilityKey] | undefined {
  const key = capabilityKey(id, version) as CapabilityKey;
  return CAPABILITY_CATALOG[key];
}

/** Returns every capability definition in the catalog. Used by the host runtime
 *  to populate its dispatch registry and by tooling (boundary lint, SDK-compat
 *  checks) that needs to enumerate the full set. */
export function listCapabilities(): Array<(typeof CAPABILITY_CATALOG)[CapabilityKey]> {
  return Object.values(CAPABILITY_CATALOG);
}

export type { NotificationDeliveryCapabilityV1 } from "./notification-delivery";
