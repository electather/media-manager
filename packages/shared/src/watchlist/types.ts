import type { CompactMediaItem } from "../home/types";
import type { MediaType } from "../media/enums";
import type { MoodId, WatchlistSource, WatchlistUserSource } from "./enums";

export interface WatchlistKey {
  tmdbId: string;
  mediaType: MediaType;
}

/** Composite id string used as a stable key for client-side lookups. */
export function keyToId(key: WatchlistKey): string {
  return `${key.mediaType}:${key.tmdbId}`;
}

export interface WatchlistItem extends CompactMediaItem {
  /** Epoch ms when the row was added (or reactivated). */
  addedAt: number;
  addedSource: WatchlistSource;
}

export interface WatchlistResponse {
  items: WatchlistItem[];
  /**
   * Opaque keyset cursor for the next page, or `null` when the caller has
   * reached the end of the user's active watchlist. Format is intentionally
   * not part of the wire contract — clients pass it back verbatim.
   */
  cursor: string | null;
  /** True when one or more enrichment lookups failed; client may show a banner. */
  partial: boolean;
}

/**
 * Cheap aggregate counts for the header pips. Powered by the `/counts`
 * endpoint so the client doesn't have to hold the full active set in memory
 * just to render the header chips. `inProgress` is the tally of rows whose
 * underlying media has an active watch position, sourced from the host
 * progress aggregator. `unavailable` is the rev 6 catch-all bucket for rows
 * with no server copy and no active request status; `total` is the sum of
 * all five visible buckets.
 */
export interface WatchlistCounts {
  ready: number;
  inProgress: number;
  awaiting: number;
  unavailable: number;
  upcoming: number;
  total: number;
}

export interface AddWatchlistRequest {
  tmdbId: string;
  mediaType: MediaType;
  source?: WatchlistUserSource;
}

export interface AddWatchlistResponse {
  item: WatchlistItem;
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
  items: WatchlistItem[];
  /** True when enrichment was incomplete and the client may show a banner. */
  partial: boolean;
}
