import { z } from "zod";
import { defineCapability, method } from "./define";

const mediaType = z.enum(["movie", "tv"]);

const mediaItem = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().nullable(),
  type: mediaType,
  genres: z.array(z.string()).default([]),
  rating: z.number().nullable(),
  overview: z.string().default(""),
  posterUrl: z.string().nullable(),
  externalIds: z
    .object({
      tmdb: z.string().optional(),
      tvdb: z.string().optional(),
      trakt: z.string().optional(),
      imdb: z.string().optional(),
    })
    .default({}),
});

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

export const MetadataV1 = defineCapability({
  id: "metadata",
  version: "v1",
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
  methods: {
    getHistory: method(
      z.object({ limit: z.number().optional(), since: z.string().optional() }),
      z.array(historyEntry),
    ),
    addToHistory: method(z.array(mediaItem), z.object({ added: z.number() })),
  },
});

export const WatchlistV1 = defineCapability({
  id: "watchlist",
  version: "v1",
  methods: {
    getWatchlist: method(z.object({ type: mediaType.optional() }), z.array(watchlistEntry)),
    addToWatchlist: method(z.array(mediaItem), z.object({ added: z.number() })),
    removeFromWatchlist: method(z.array(mediaItem), z.object({ removed: z.number() })),
  },
});

export const RatingsV1 = defineCapability({
  id: "ratings",
  version: "v1",
  methods: {
    getRatings: method(z.object({ type: mediaType.optional() }), z.array(ratingEntry)),
    setRating: method(
      z.object({ item: mediaItem, rating: z.number().min(0).max(10) }),
      z.object({ ok: z.boolean() }),
    ),
  },
});

export const RecommendationsV1 = defineCapability({
  id: "recommendations",
  version: "v1",
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
  methods: {
    getUpcoming: method(z.object({ days: z.number().optional() }), z.array(upcoming)),
  },
});

export const MediaRequestV1 = defineCapability({
  id: "mediaRequest",
  version: "v1",
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

export const IdResolveV1 = defineCapability({
  id: "idResolve",
  version: "v1",
  methods: {
    resolve: method(idResolveInput, idResolveOutput),
  },
});

/**
 * Host-side registry of known capabilities. The registry is indexed by
 * `${id}@${version}` — plugins declare the versioned id in their manifest.
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
