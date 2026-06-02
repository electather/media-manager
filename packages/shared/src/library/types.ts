import type { CompactMediaItem } from "../media/page";
import type { MediaType } from "../media/enums";
import type { WatchedState } from "./enums";

/**
 * One owned franchise grouping returned by the Collections lens. `preview`
 * holds up to four enriched items so the card can fan their posters without a
 * second fetch (design §Collections lens). `count` is the total owned titles in
 * the franchise, which may exceed `preview.length`.
 */
export interface LibraryCollection {
  /** Composite id `collection:<tmdbCollectionId>`. */
  id: string;
  title: string;
  count: number;
  preview: CompactMediaItem[];
}

/**
 * Unfiltered facet totals for the library, served by `/api/library/facets`.
 * Counts are whole-library totals (not filter-aware) to match the mock look
 * (design §Facets). `letters` and `decades` are present-only — they list only
 * the buckets that have at least one owned title, powering the A→Z rail and the
 * timeline decade markers respectively.
 */
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
