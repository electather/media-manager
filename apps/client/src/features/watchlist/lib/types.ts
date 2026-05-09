import type { CompactMediaItem } from "@ent-mcp/shared/home";

/**
 * UI projection of a watchlist item. Mirrors `CompactMediaItem` so the
 * existing `MediaDetailModal` can render it directly. Adds a `relDate` slot
 * for the "Coming up" calendar strip — the prototype paints a relative
 * label there before any wire data exists.
 */
export type WatchlistItem = CompactMediaItem & {
  clearLogoText?: string;
  /** Pre-formatted relative date for the upcoming strip ("Tomorrow", "In 5 days"). */
  relDate?: string;
  /** Why this picks for tonight. Falls back to a generic reason when absent. */
  matchReasonText?: string;
};

export type WatchlistFilter = "all" | "available" | "in-progress" | "requested" | "upcoming";

export type WatchlistSort = "recent" | "alpha" | "runtime" | "status";

export type WatchlistStatus =
  | "in-progress"
  | "available"
  | "requested"
  | "unavailable"
  | "upcoming";

export type WatchlistBuckets = {
  available: WatchlistItem[];
  inProgress: WatchlistItem[];
  requested: WatchlistItem[];
  unavailable: WatchlistItem[];
  upcoming: WatchlistItem[];
};

export type WatchlistCounts = {
  available: number;
  inProgress: number;
  requested: number;
  unavailable: number;
  upcoming: number;
};

export type MoodGroup = {
  id: string;
  labelKey:
    | "watchlist_mood_slow_burn_label"
    | "watchlist_mood_quiet_thrill_label"
    | "watchlist_mood_period_label"
    | "watchlist_mood_scifi_label"
    | "watchlist_mood_comedy_label"
    | "watchlist_mood_horror_label";
  noteKey:
    | "watchlist_mood_slow_burn_note"
    | "watchlist_mood_quiet_thrill_note"
    | "watchlist_mood_period_note"
    | "watchlist_mood_scifi_note"
    | "watchlist_mood_comedy_note"
    | "watchlist_mood_horror_note";
  items: WatchlistItem[];
};

export type RecentLogEntry = {
  item: WatchlistItem;
  /** Pre-formatted relative timestamp ("2 hours ago"). Already localised. */
  added: string;
  /** Pre-formatted source label ("Recommended for you"). Already localised. */
  source: string;
};
