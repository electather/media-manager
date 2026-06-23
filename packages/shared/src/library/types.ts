import type { CompactMediaItem } from "../media/page";
import type { MediaType } from "../media/enums";
import type { WatchedState } from "./enums";

/** Franchise grouping from Collections lens. `preview`: up to 4 items to fan posters without second fetch (design §Collections lens). `count`: total owned titles in franchise (may exceed preview.length). */
export interface LibraryCollection {
  /** Composite id `collection:<tmdbCollectionId>`. */
  id: string;
  title: string;
  count: number;
  preview: CompactMediaItem[];
}

/** Unfiltered facet totals from `/api/library/facets`. Whole-library counts (not filter-aware, design §Facets). `letters` and `decades`: present-only buckets with owned titles, powering A→Z rail and timeline markers. */
export interface LibraryFacetCounts {
  /** Owned titles per media type, keyed by `MediaType`. */
  kinds: Record<MediaType, number>;
  /** Owned titles per genre, expanded via `json_each(genres)`. */
  genres: Record<string, number>;
  /** Owned titles per quality tier, expanded via `json_each(qualityTiers)`. */
  qualities: Record<string, number>;
  /** Owned titles per server, expanded via `json_each(servers)`. */
  servers: Record<string, number>;
  /** Owned titles per watched state. */
  watched: Record<WatchedState, number>;
  /** Distinct first characters of `sortTitle` (e.g. `"A".."Z"`, `"#"`). */
  letters: string[];
  /** Distinct decades present, newest first (e.g. `[2020, 2010]`). */
  decades: number[];
}

/**
 * Paginated response shape for `/api/library/collections`. The `cursor` is an
 * opaque keyset token (mirrors the media `Page` cursor convention) and is
 * `null` once the caller reaches the last group.
 */
export interface LibraryCollectionsResponse {
  collections: LibraryCollection[];
  cursor: string | null;
}
