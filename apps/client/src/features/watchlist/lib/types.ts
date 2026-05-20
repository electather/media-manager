/**
 * UI-only types for the watchlist page. Cross-feature surfaces should import
 * data-layer pieces (`WatchlistItem`, `WatchlistApiError`, `sourceLabel`,
 * `fetchWatchlist`, etc.) from `@/shared/lib/watchlist` instead.
 */
import type { WatchlistItem } from "@/shared/lib/watchlist";

export { WatchlistApiError, sourceLabel, type WatchlistItem } from "@/shared/lib/watchlist";

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
}

export interface WatchlistMoodGroup {
  mood: WatchlistMood;
  items: WatchlistItem[];
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
