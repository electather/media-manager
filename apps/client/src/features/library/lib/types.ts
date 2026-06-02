import type { CompactMediaItem, MediaType } from "@ent-mcp/shared/media";

/**
 * The library renders the same wire shape as the home feed. Quality tiers ride
 * along on `CompactMediaItem.tags` (e.g. `["4K HDR", "Atmos"]`) and server
 * availability on `availability.servers`, so no feature-local extension of the
 * media item is needed — the shared `MediaRowCard` consumes it directly.
 */
export type LibraryItem = CompactMediaItem;

/**
 * The five viewing "lenses" the page slices its catalog through. Each is a
 * different grouping of the same filtered item set (design: lens tabs).
 */
export const LIBRARY_LENSES = ["az", "timeline", "collections", "server", "quality"] as const;
export type LibraryLens = (typeof LIBRARY_LENSES)[number];

/** Watched-progress buckets used by the filter facet. */
export const WATCHED_STATES = ["watched", "partial", "unwatched"] as const;
export type WatchedState = (typeof WATCHED_STATES)[number];

/** The facet axes a user can narrow the catalog by, in addition to free-text search. */
export interface LibraryFilters {
  kinds: MediaType[];
  genres: string[];
  qualities: string[];
  servers: string[];
  watched: WatchedState[];
}

/** An empty filter set — every axis open. */
export const EMPTY_FILTERS: LibraryFilters = {
  kinds: [],
  genres: [],
  qualities: [],
  servers: [],
  watched: [],
};

/** A curated, user-defined grouping of items, surfaced by the Collections lens. */
export interface LibraryCollection {
  id: string;
  title: string;
  /** Composite ids referencing items in the library set. */
  itemIds: string[];
}

/** The full mock payload the (currently mocked) library fetch resolves. */
export interface LibraryData {
  items: LibraryItem[];
  collections: LibraryCollection[];
}

/** Per-option match counts shown as badges next to each facet pill. */
export interface LibraryFacetCounts {
  kinds: Record<string, number>;
  genres: Record<string, number>;
  qualities: Record<string, number>;
  servers: Record<string, number>;
  watched: Record<WatchedState, number>;
}
