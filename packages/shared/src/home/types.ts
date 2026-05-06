import type { HostErrorCode } from "../errors";
import type { HeroReason, MatchReasonKey, RowKind } from "./enums";

/**
 * Typed match-reason payload. The client renders the i18n message for `key`
 * with the supplied ICU `params` so server-side row context (seed title,
 * matched genre, recent-pick count, …) can flow through to copy without the
 * client having to recreate the heuristic.
 *
 * The matching catalog rec-list path still emits the prose explanation as a
 * plain string for the MCP discover tool; the home wire union accepts both
 * shapes during the PR1→PR6 transitional window. PR6 narrows back to the
 * structured form once every emitter has migrated.
 */
export interface MatchReason {
  key: MatchReasonKey;
  /** ICU placeholders (e.g. `{ genre: "Drama" }` or `{ seedTitle: "Heat" }`). */
  params: Record<string, string>;
}

/**
 * Per-item availability snapshot derived from the user's library plugins.
 * `servers` lists every plugin that reports a copy; the UI renders chips for
 * each. `requestEligible` is independent of `hasAnyServerCopy` — a title may
 * already be in the library yet still be eligible to request a higher-quality
 * cut, so the client decides which buttons to render.
 */
export interface Availability {
  hasAnyServerCopy: boolean;
  requestEligible: boolean;
  servers: { id: string; label: string }[];
}

/**
 * Display facets the home rows surface in their card chips. Server picks the
 * most readable form for each field — `releaseDate` is typically the year as
 * a string for the home feed and graduates to ISO date when richer time
 * context lands.
 */
export interface Facets {
  runtimeMin?: number;
  episodeCount?: number;
  releaseDate?: string;
}

/**
 * TV-only context surfaced by the `continueWatching-next` row. `nextUpFromServer`
 * distinguishes a server-stitched "watch this episode next" entry from a row
 * that derived the season/episode locally — the UI uses the flag to pick copy
 * ("Up next on Plex" vs "Continue series").
 */
export interface SeriesContext {
  season: number;
  episode: number;
  episodeTitle: string;
  nextUpFromServer: boolean;
}

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
  /**
   * Set on rows that surface a "why this is here" chip. Transitional union:
   * the catalog rec-list job and the MCP discover tool still emit plain prose
   * via `PreferenceEngine.explainRanked`, so the wire accepts both shapes
   * during the PR1→PR6 home-feed migration window. The client narrows to the
   * structured form once every emitter has migrated (PR6).
   */
  matchReason?: string | MatchReason;
  status?: "available" | "requested" | "processing" | "unavailable" | "unknown";
  /** Library / request availability snapshot. */
  availability?: Availability;
  /** Display facets for the card chip strip. */
  facets?: Facets;
  /** Season/episode context for `continueWatching-next` items. */
  seriesContext?: SeriesContext;
  /** Set on `upcomingForYou` items only. */
  episode?: {
    season: number;
    episode: number;
    /** Air time in ms epoch. */
    airsAt: number;
    name?: string;
  };
  /**
   * Reserved for a future media-features capability (e.g. `["4K","HDR","Atmos"]`).
   * Always undefined in v1; the client renders nothing when absent.
   */
  tags?: string[];
}

export interface LayoutHero {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  /**
   * Server-resolved deep link for resume; null when no playable source available.
   * Always null in v1 (the plugin SDK has no `playback@v1.getResumeUrl` method
   * yet); the client renders Play as a navigate-to-detail action.
   */
  resumeUrl: string | null;
  /**
   * Up to four crossfade backdrops drawn from the same source as `item`. Empty
   * when no alternates are available (single-eligible-item edge case).
   */
  alternates: CompactMediaItem[];
}

/**
 * Row structure returned by `getLayout`. Contains no items — use
 * `getRowContent` to load them. `rowId` is an opaque registry slug
 * (e.g. `"recommendedForYou-tv"`) and `kind` is the display category that
 * determines the card layout.
 */
export interface HomeRowStub {
  rowId: string;
  kind: RowKind;
  /** i18n message key resolved client-side via Paraglide. */
  titleKey: string;
  /** Optional secondary line; same key flavour as `titleKey`. */
  subtitleKey?: string;
  /**
   * Cursor to pass as the first `getRowContent` call. Null means first page;
   * non-null pins a seed (e.g. `becauseYouWatched`).
   */
  initialCursor: string | null;
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

/**
 * Detail-modal extra fields layered on top of the catalog summary. `null`
 * fields are omitted entirely from the wire so client renderers can rely on
 * `if (extra.director)` checks. The composition is plugin-driven so each
 * field is best-effort; missing data renders as a hidden row, not a blank.
 */
export interface MediaDetailsExtra {
  cast: string[];
  director?: string;
  ageRating?: string;
  audienceScore?: number;
  criticScore?: number;
  votes?: number;
  trailerUrl?: string;
  nextAirDate?: string;
  seriesStatus?: "ongoing" | "finished";
  /** Pre-formatted runtime string, e.g. `"1h 58m"`. */
  runtime?: string;
}

/**
 * `home.getDetails` response. `details` is null when the metadata plugin
 * rejects the call; callers fall back to rendering only the summary card and
 * surface `error.code` (a `HostErrorCode`) for retry copy.
 */
export interface MediaDetailsResponse {
  summary: CompactMediaItem;
  details: MediaDetailsExtra | null;
  /** Present iff `details === null`. */
  error?: { code: HostErrorCode };
}
