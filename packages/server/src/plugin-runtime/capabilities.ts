import { z } from "zod";
import { defineCapability, method } from "./define";

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
  userScoped: false,
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
  userScoped: true,
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
  userScoped: true,
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
  userScoped: true,
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
  userScoped: true,
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
  userScoped: true,
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
  userScoped: true,
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
 * ⚠ **Mixed-scope, but `userScoped: false` on the host definition.** Global
 * plugins (Trakt/TMDB/TVDB) own cross-service id resolution; user-scoped
 * plugins (Plex/Jellyfin) own server-local ids (`plex:ratingKey`,
 * `jellyfin:itemId`). The capability schema accepts both scopes at the plugin
 * side, but this flag dictates dispatch routing (see `media/dispatcher.ts`)
 * and cache key scoping (see `media/cache.ts`). Keeping it `false` preserves
 * routing to global providers; flipping it would exclude them.
 *
 * Consequences until #29 lands:
 * - User-scoped `idResolve` providers are registered but unreachable via the
 *   dispatcher.
 * - The cache key for `idResolve@v1` is keyed by `(from, id, type)` only. A
 *   hypothetical server-local resolution written through this cache would be
 *   shared across users; the dispatcher gap prevents that today, and #29 must
 *   land before user-scoped `idResolve` results can be routed safely.
 */
export const IdResolveV1 = defineCapability({
  id: "idResolve",
  version: "v1",
  strategy: "single",
  userScoped: false,
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
  userScoped: true,
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
  userScoped: false,
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
  userScoped: false,
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
  userScoped: true,
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

/** collection@v1 — user's owned/collected library. */
export const CollectionV1 = defineCapability({
  id: "collection",
  version: "v1",
  strategy: "aggregate",
  userScoped: true,
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
