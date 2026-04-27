import { z } from "zod";
import { libraryItemSchema, LIBRARY_ITEM_QUERY_TYPES } from "@ent-mcp/shared/plugins/library";
import { defineCapability, method } from "../define";
import { MIN } from "./shared-schemas";

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
export const libraryItemQueryType = z.enum(LIBRARY_ITEM_QUERY_TYPES);

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
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    checkAvailability: method(checkInput, checkOutput),
    listRecentlyAdded: method(recentlyAddedInput, recentlyAddedOutput),
    searchLibrary: method(searchInput, z.array(libraryItemSchema)),
  },
});
