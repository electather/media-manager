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
  /** True when one or more enrichment lookups failed; client may show a banner. */
  partial: boolean;
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
