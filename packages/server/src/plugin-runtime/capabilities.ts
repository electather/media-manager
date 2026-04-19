import { z } from "zod";
import { defineCapability, method } from "./define";

const mediaType = z.enum(["movie", "tv"]);

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

const idKinds = z.enum(["tmdb", "tvdb", "trakt", "imdb"]);

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
  },
});

/** Internal-only capability: not invoked directly by callers — only by MediaService id_map gap-fill. */
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
