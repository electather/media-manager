import type { HeroReason, RowKind } from "./enums";

/**
 * Wire-format media item used across home rows. Lean than `MediaItem`:
 * absent fields are omitted (not null) and dashboard-only fields like
 * `backdrop`/`progress`/`episodeProgress` ride along when relevant.
 */
export interface CompactMediaItem {
  /** Composite id, e.g. `"movie:550"` or `"tv:1396"`. */
  id: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  clearLogo?: string;
  /** Within-content position (movie OR episode); absent when unmeasurable. */
  progress?: { watched: number; total: number };
  /** TV-only season position, e.g. "2/12 watched". */
  episodeProgress?: { watched: number; total: number };
  overview?: string;
  /** Top three genres. */
  genres?: string[];
  /** Aggregated rating; omitted when no source supplied one. */
  rating?: number;
  /** User's own rating from `ratings@v1`; omitted when absent. */
  userRating?: number;
  /** Set on `recommendedForYou` and `becauseYouWatched`. */
  matchReason?: string;
  status?: "available" | "requested" | "processing" | "unavailable" | "unknown";
  /** Set on `upcomingForYou` items only. */
  episode?: {
    season: number;
    episode: number;
    /** Air time in ms epoch. */
    airsAt: number;
    name?: string;
  };
}

export interface HomeRow {
  rowId: RowKind;
  /** Default copy for the row. */
  title: string;
  /** Set when hero exclusion changed the row's meaning (e.g. "Also watching"). */
  titleOverride?: string;
  subtitle?: string;
  items: CompactMediaItem[];
  /** Opaque cursor for the next page; null at end of pagination. */
  cursor: string | null;
  /** Set when an aggregate plugin set returned partial data. */
  partial?: true;
}

export interface LayoutHero {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  /** Server-resolved deep link for resume; null when no playable source available. */
  resumeUrl: string | null;
}

/** Row structure returned by `getLayout`. Contains no items — use `getRowContent` to load them. */
export interface HomeRowStub {
  rowId: RowKind;
  title: string;
  titleOverride?: string;
  subtitle?: string;
  /** Cursor to pass as the first `getRowContent` call. Null means first page; non-null pins a seed (e.g. `becauseYouWatched`). */
  initialCursor: string | null;
  /** Set when the hero fetch returned partial data for this row's source. */
  partial?: true;
}

export interface HomeLayoutResponse {
  hero: LayoutHero | null;
  rows: HomeRowStub[];
  /** Server clock at response assembly, ms epoch. */
  generatedAt: number;
}

export interface RowContentResponse {
  items: CompactMediaItem[];
  cursor: string | null;
  partial?: true;
}
