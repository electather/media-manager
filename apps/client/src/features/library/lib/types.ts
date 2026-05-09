import type { HomeMediaItem } from "@/features/home/lib/types";

export type LibraryItem = HomeMediaItem;

export type LibraryStatus =
  | "available"
  | "in-progress"
  | "requested"
  | "unavailable"
  | "upcoming"
  | "unknown";

export type LibraryFilter = "all" | "ready" | "in-progress" | "awaiting" | "upcoming";

export type LibrarySort = "recent" | "alpha" | "runtime" | "status";

export interface LibraryMood {
  id: string;
  labelKey:
    | "library_mood_slow_burn"
    | "library_mood_quiet_thrill"
    | "library_mood_period"
    | "library_mood_scifi"
    | "library_mood_comedy"
    | "library_mood_horror";
  noteKey:
    | "library_mood_slow_burn_note"
    | "library_mood_quiet_thrill_note"
    | "library_mood_period_note"
    | "library_mood_scifi_note"
    | "library_mood_comedy_note"
    | "library_mood_horror_note";
  itemIds: string[];
}

export interface LibraryMoodGroup {
  mood: LibraryMood;
  items: LibraryItem[];
}

export type RecentSourceKey =
  | "library_recent_source_recommended"
  | "library_recent_source_notification"
  | "library_recent_source_search"
  | "library_recent_source_trending"
  | "library_recent_source_friend";

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

export interface LibraryBuckets {
  available: LibraryItem[];
  inProgress: LibraryItem[];
  requested: LibraryItem[];
  unavailable: LibraryItem[];
  upcoming: LibraryItem[];
}

export interface LibraryCounts {
  ready: number;
  inProgress: number;
  awaiting: number;
  upcoming: number;
}
