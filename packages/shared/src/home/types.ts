import type { HostErrorCode } from "../diagnostics";
import type { MediaType } from "../media/enums";
import type { WatchlistSource } from "../watchlist/enums";
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
  mediaType: MediaType;
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
   * Set on rows that surface a "why this is here" chip. The client renders
   * `key` to localized copy with `params` filling in ICU placeholders. The
   * MCP discover tool keeps its own plain-prose `match_reason` field on a
   * separate snake-case shape — those callers no longer flow through this
   * wire type.
   */
  matchReason?: MatchReason;
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
  /**
   * Epoch ms when a persistent-table row was added (or reactivated). Filled by
   * watchlist-backed sources; discovery rows leave it absent/null.
   */
  addedAt?: number | null;
  /** How a persistent-table row entered the watchlist; absent/null on discovery rows. */
  addedSource?: WatchlistSource | null;
}

/**
 * One hero slide. Each slide carries its own `source` / `reason` / `resumeUrl`
 * because the hero now mixes items across sources (continueWatching,
 * recommendedForYou, trendingNow, newReleases) instead of cascading to a
 * single source per render. The client renders the source label per active
 * slide, and the carousel cycles through the slides in order.
 *
 * `resumeUrl` is always `null` v1 — the plugin SDK has no
 * `playback@v1.getResumeUrl` method yet, so the client treats Play as a
 * navigate-to-detail action regardless of source.
 */
export interface HeroSlide {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
}

/**
 * Hero region payload. `slides[0]` is the lead (auto-shown on first paint);
 * subsequent entries are reached via the carousel. `LayoutHero` is `null` on
 * the wire only when every source pool is empty; otherwise `slides.length`
 * is between 1 and 6 inclusive (degenerate fill ships fewer than 6).
 */
export interface LayoutHero {
  slides: HeroSlide[];
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
  eyebrowKey?: string;
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
  /**
   * Canonical TV season list with eager episode metadata. Populated only when
   * `mediaType === "tv"` and the metadata plugin returned a season payload;
   * best-effort, so the field is omitted on plugin failure rather than null.
   * Per-server availability ships separately via `home.getSeasonAvailability`
   * (different freshness profile — day vs. minute cache).
   */
  seasons?: SeasonInfo[];
}

/**
 * Per-episode metadata inside a `SeasonInfo`. `airDate` is ISO `YYYY-MM-DD`
 * pass-through from TMDB; `runtime` is in minutes.
 */
export interface SeasonEpisodeInfo {
  episodeNumber: number;
  title: string;
  airDate?: string;
  runtime?: number;
}

/**
 * Canonical season payload from the metadata plugin. `episodes.length` may
 * differ from `totalEpisodes` for unaired seasons whose enumeration trails the
 * announced count.
 */
export interface SeasonInfo {
  seasonNumber: number;
  name: string;
  airDate?: string;
  totalEpisodes: number;
  episodes: SeasonEpisodeInfo[];
}

/**
 * Per-server availability slice for a single show. `episodesPresent` is a
 * sorted-ascending flat list of `{ season, episode }` pairs the server holds;
 * the client buckets to seasons during render.
 */
export interface SeasonAvailabilityServer {
  serverId: string;
  serverLabel: string;
  episodesPresent: { season: number; episode: number }[];
}

/**
 * Per-plugin failure surfaced alongside successful servers in
 * `SeasonAvailabilityResponse`. `code` is a classified `HostErrorCode` so the
 * UI can pick localised microcopy without parsing free-form messages.
 */
export interface SeasonAvailabilityError {
  serverId: string;
  serverLabel: string;
  code: HostErrorCode;
}

/**
 * `home.getSeasonAvailability` response. `servers` is empty when the user has
 * no `libraryAvailability@v1` provider configured (not an error). Per-plugin
 * failures populate `errors[]` while successful servers still appear in
 * `servers[]`.
 */
export interface SeasonAvailabilityResponse {
  servers: SeasonAvailabilityServer[];
  errors?: SeasonAvailabilityError[];
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
