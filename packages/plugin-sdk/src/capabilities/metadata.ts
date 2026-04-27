import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, mediaItem, DAY, MIN } from "./shared-schemas";

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
  /**
   * Inclusive lower bound on release date as ms epoch. Ignored by plugins
   * that do not support a release-date filter; backward-compatible.
   */
  releaseDateGte: z.number().optional(),
  /** Inclusive upper bound on release date as ms epoch. */
  releaseDateLte: z.number().optional(),
  /**
   * Result ordering hint. `popularity_desc` is the home feed's default for
   * `newReleases`; plugins that do not support a sort key fall back to their
   * native ordering.
   */
  sort: z
    .enum(["popularity_desc", "popularity_asc", "release_date_desc", "release_date_asc"])
    .optional(),
});

/** metadata@v1 — primary_with_enrichment. User picks a primary per media type;
 *  other plugins fill fields where the primary returned null/missing. */
export const MetadataV1 = defineCapability({
  id: "metadata",
  version: "v1",
  strategy: { kind: "primary_with_enrichment" },
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
