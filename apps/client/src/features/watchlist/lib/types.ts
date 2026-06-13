import type { CompactMediaItem } from "@nama/shared/media";
import type { WatchlistSource } from "@nama/shared/watchlist";
import * as m from "@/paraglide/messages";

/** Localized label for an item's `addedSource` field. */
export function sourceLabel(source: WatchlistSource): string {
  return m.watchlist_source({ source });
}

// Per-card status overlay consumed by `classify.ts`. The bucket axis lives
// on the server now (`WatchlistBucket`); this local enum keeps `in-progress`
// distinct from `available` for card chrome only.
export type WatchlistStatus =
  | "available"
  | "in-progress"
  | "requested"
  | "unavailable"
  | "upcoming"
  | "unknown";

export interface WatchlistBuckets {
  available: CompactMediaItem[];
  inProgress: CompactMediaItem[];
  requested: CompactMediaItem[];
  unavailable: CompactMediaItem[];
  upcoming: CompactMediaItem[];
}
