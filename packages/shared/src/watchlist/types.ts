import type { CompactMediaItem } from "../home/types";
import type { MediaType } from "../media/enums";
import type { MoodId, WatchlistUserSource } from "./enums";

export interface WatchlistKey {
  tmdbId: string;
  mediaType: MediaType;
}

/** Composite id string used as a stable key for client-side lookups. */
export function keyToId(key: WatchlistKey): string {
  return `${key.mediaType}:${key.tmdbId}`;
}

export interface WatchlistResponse {
  items: CompactMediaItem[];
  /**
   * Opaque keyset cursor for the next page, or `null` when the caller has
   * reached the end of the user's active watchlist. Format is intentionally
   * not part of the wire contract — clients pass it back verbatim.
   */
  cursor: string | null;
  /** True when one or more enrichment lookups failed; client may show a banner. */
  partial: boolean;
}

// fallow-ignore-next-line code-duplication
export interface AddWatchlistRequest {
  tmdbId: string;
  mediaType: MediaType;
  source?: WatchlistUserSource;
}

export interface AddWatchlistResponse {
  item: CompactMediaItem;
  /** True when the row was already active before this request. */
  wasActive: boolean;
}

/** Single mood cluster summary entry returned by `/api/watchlist/moods`. */
export interface MoodSummaryCluster {
  moodId: MoodId;
  count: number;
}

/** Aggregate mood summary across the active set. */
export interface WatchlistMoodSummary {
  clusters: MoodSummaryCluster[];
}

/** `/api/watchlist/sections/tonight` and `/sections/recently` payload shape. */
export interface WatchlistSectionResponse {
  items: CompactMediaItem[];
  /** True when enrichment was incomplete and the client may show a banner. */
  partial: boolean;
}
