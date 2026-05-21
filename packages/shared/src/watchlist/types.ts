import type { CompactMediaItem } from "../home/types";
import type { MediaType } from "../media/enums";
import type { WatchlistSource, WatchlistUserSource } from "./enums";

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
 * just to render the header chips. `inProgress` is a strict subset of
 * `ready` — rows whose underlying media has an active watch position. The
 * list-side `filter=ready` collapses `inProgress` into `ready`, but the
 * dedicated count keeps the chip authoritative across paginated loads.
 */
export interface WatchlistCounts {
  ready: number;
  inProgress: number;
  awaiting: number;
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
