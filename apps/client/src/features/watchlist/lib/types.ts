import type { CompactMediaItem } from "@ent-mcp/shared/media";
import type { WatchlistSource } from "@ent-mcp/shared/watchlist";
import * as m from "@/paraglide/messages";

/** Localized label for an item's `addedSource` field. */
// fallow-ignore-next-line complexity
export function sourceLabel(source: WatchlistSource): string {
  switch (source) {
    case "manual":
      return m.watchlist_source_manual();
    case "plugin":
      return m.watchlist_source_plugin();
    case "search":
      return m.watchlist_source_search();
    case "notification":
      return m.watchlist_source_notification();
    case "recommended":
      return m.watchlist_source_recommended();
    case "trending":
      return m.watchlist_source_trending();
  }
}

export type { WatchlistCounts } from "@ent-mcp/shared/watchlist";

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
