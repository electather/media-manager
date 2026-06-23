import { z } from "zod";
import { libraryItemSchema } from "@nama/shared/plugins/library";
import { defineCapability, method } from "../define";
import { MIN, libraryItemQueryType } from "./shared-schemas";

// Covers cross-service ids (tmdb, imdb, tvdb) and server-local ids (plex, jellyfin)
// so callers can skip the resolve step; accepted by libraryAvailability@v1.checkAvailability.
const libraryAvailabilityIdType = z.enum(["tmdb", "imdb", "tvdb", "plex", "jellyfin"]);

const checkInput = z.object({
  /** Identifier value; its flavour is tagged by `idType`. */
  id: z.string().min(1),
  idType: libraryAvailabilityIdType,
  type: libraryItemQueryType,
});

const checkOutput = z.object({
  /**
   * Zero or more matches — multiple quality copies of the same title (e.g. 4k
   * HDR alongside 1080p SDR) each surface as their own entry so callers can
   * pick the right one to play.
   */
  items: z.array(libraryItemSchema),
});

const recentlyAddedInput = z.object({
  type: libraryItemQueryType.optional(),
  /** Page size; plugins clamp server-side to a sensible max. */
  limit: z.number().optional(),
  /** Opaque cursor returned by the previous page, or omitted for the first page. */
  cursor: z.string().optional(),
});

const recentlyAddedOutput = z.object({
  items: z.array(libraryItemSchema),
  /** Opaque cursor for the next page; absent when there is no next page. */
  nextCursor: z.string().optional(),
});

const searchInput = z.object({
  query: z.string().min(1),
  type: libraryItemQueryType.optional(),
  limit: z.number().optional(),
});

const listAvailableInput = z.object({
  type: libraryItemQueryType,
});

/**
 * Input for `listShowEpisodes`. Same `idType` vocabulary as
 * `checkAvailability` so callers holding e.g. a `tmdb` id or a server-local
 * Plex ratingKey can both reach the show.
 */
const listShowEpisodesInput = z.object({
  id: z.string().min(1),
  idType: libraryAvailabilityIdType,
});

/**
 * Output for `listShowEpisodes` — flat presence list. Host buckets to seasons
 * map; plugin is a pure pass-through over the underlying server endpoint.
 */
const listShowEpisodesOutput = z.object({
  episodes: z.array(z.object({ season: z.number(), episode: z.number() })),
});

// Bulk presence index: returns TMDB ids from the library for N lookups
// in one round-trip + O(1) set lookups, vs N checkAvailability probes.
// Empty list falls back to per-id checks.
const listAvailableOutput = z.object({
  tmdbIds: z.array(z.string()),
});

// libraryAvailability@v1: does the user's self-hosted media server have this item?
// See design doc's "New capability contracts" section for backing endpoints.
// No mcpTools yet (#22, #23); tools will reference real backing methods, not stubs.
export const LibraryAvailabilityV1 = defineCapability({
  id: "libraryAvailability",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    checkAvailability: method(checkInput, checkOutput),
    listRecentlyAdded: method(recentlyAddedInput, recentlyAddedOutput),
    searchLibrary: method(searchInput, z.array(libraryItemSchema)),
    listAvailable: method(listAvailableInput, listAvailableOutput),
    /**
     * Episode-level presence enumeration for a single show. 5-min cached
     * (capability default); host aggregates across the user's connections.
     */
    listShowEpisodes: method(listShowEpisodesInput, listShowEpisodesOutput),
  },
});
