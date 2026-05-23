import type {
  WatchlistItem as SharedWatchlistItem,
  WatchlistSource,
} from "@ent-mcp/shared/watchlist";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import * as m from "@/paraglide/messages";

export type WatchlistItem = SharedWatchlistItem;

export class WatchlistApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  // fallow-ignore-next-line complexity
  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? body?.devMessage ?? `watchlist request failed (${status})`);
    this.name = "WatchlistApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

/** Localized label for an item's `addedSource` field. */
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

// UI-only types — Phase 4 drops these alongside classify.ts / derive-moods.ts
// / watchlist-content.tsx once per-section pages own their own state.
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
