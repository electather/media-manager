import type { HomeMediaItem } from "@/features/home/lib/types";

export type WatchlistItem = HomeMediaItem;

export type WatchlistStatus =
  | "available"
  | "in-progress"
  | "requested"
  | "unavailable"
  | "upcoming"
  | "unknown";

export type WatchlistFilter = "all" | "ready" | "in-progress" | "awaiting" | "upcoming";

export type WatchlistSort = "recent" | "alpha" | "runtime" | "status";

export interface WatchlistMood {
  id: string;
  labelKey:
    | "watchlist_mood_slow_burn"
    | "watchlist_mood_quiet_thrill"
    | "watchlist_mood_period"
    | "watchlist_mood_scifi"
    | "watchlist_mood_comedy"
    | "watchlist_mood_horror";
  noteKey:
    | "watchlist_mood_slow_burn_note"
    | "watchlist_mood_quiet_thrill_note"
    | "watchlist_mood_period_note"
    | "watchlist_mood_scifi_note"
    | "watchlist_mood_comedy_note"
    | "watchlist_mood_horror_note";
  itemIds: string[];
}

export interface WatchlistMoodGroup {
  mood: WatchlistMood;
  items: WatchlistItem[];
}

export type RecentSourceKey =
  | "watchlist_recent_source_recommended"
  | "watchlist_recent_source_notification"
  | "watchlist_recent_source_search"
  | "watchlist_recent_source_trending"
  | "watchlist_recent_source_friend";

export interface RecentLogEntry {
  itemId: string;
  /** Resolved at render via paraglide; e.g. ICU `{ n: 2 }` for hours-ago. */
  time:
    | { kind: "hours-ago"; n: number }
    | { kind: "days-ago"; n: number }
    | { kind: "yesterday" }
    | { kind: "last-week" };
  sourceKey: RecentSourceKey;
}

export interface WatchlistBuckets {
  available: WatchlistItem[];
  inProgress: WatchlistItem[];
  requested: WatchlistItem[];
  unavailable: WatchlistItem[];
  upcoming: WatchlistItem[];
}

export interface WatchlistCounts {
  ready: number;
  inProgress: number;
  awaiting: number;
  upcoming: number;
}
