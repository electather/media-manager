import type { HostErrorCode } from "../diagnostics";
import type { MediaType } from "../media/enums";
import type { WatchlistSource } from "../watchlist/enums";
import type { HeroReason, MatchReasonKey, RowKind } from "./enums";

/**
 * Typed match-reason payload. Client renders i18n message for `key` with ICU
 * `params` so server-side context (seed title, genre, etc.) flows to copy.
 * PR1→PR6 transitional: MCP discover tool still emits plain prose; home wire
 * accepts both shapes until all emitters migrate.
 */
export interface MatchReason {
  key: MatchReasonKey;
  /** ICU placeholders (e.g. `{ genre: "Drama" }` or `{ seedTitle: "Heat" }`). */
  params: Record<string, string>;
}

/**
 * Per-item availability snapshot from library plugins. `servers` lists plugins
 * reporting a copy; UI renders chips for each. `requestEligible` is independent
 * of `hasAnyServerCopy` — may exist yet remain eligible to request higher quality.
 */
export interface Availability {
  hasAnyServerCopy: boolean;
  requestEligible: boolean;
  servers: { id: string; label: string }[];
}

/**
 * Display facets for card chips. Server picks readable form per field:
 * `releaseDate` is year string for home, ISO date elsewhere.
 */
export interface Facets {
  runtimeMin?: number;
  episodeCount?: number;
  releaseDate?: string;
}

/**
 * TV-only context for `continueWatching-next` row. `nextUpFromServer` flags
 * server-stitched "watch next" entries vs locally-derived ones; UI picks copy
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
   * "Why this is here" chip payload. Client renders `key` to localized copy
   * with `params` filling ICU placeholders. MCP discover tool uses separate
   * snake-case `match_reason` field; those callers don't use this wire type.
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
   * Free-form display tags. Library lenses populate with quality-tier strings
   * (e.g. `["1080p","4K"]`); card chips and quality facet read this. Home and
   * discovery sources leave undefined; reserved media-features capability not yet emitted.
   */
  tags?: string[];
  /**
   * Epoch ms when a persistent-table row was added (or reactivated). Filled by
   * watchlist-backed sources; discovery rows leave it absent/null.
   */
  addedAt?: number | null;
  /** How a persistent-table row entered the watchlist; absent/null on discovery rows. */
  addedSource?: WatchlistSource | null;
  /**
   * Section grouping for library `server`/`quality` lenses (json_each expansion).
   * `id` is group key (server connection id or tier label); `label` is header.
   * FE inserts header when `section.id` changes, keys list on `id + section.id`
   * (not `id` alone). Absent on non-grouped sources.
   */
  section?: { id: string; label: string };
}

/**
 * One hero slide. Each carries own `source`/`reason`/`resumeUrl` because hero
 * now mixes items across sources (continueWatching, recommendedForYou, etc.)
 * instead of cascading to single source per render.
 *
 * `resumeUrl` always `null` v1 — plugin SDK lacks `playback@v1.getResumeUrl`
 * method, so client treats Play as navigate-to-detail.
 */
export interface HeroSlide {
  item: CompactMediaItem;
  source: RowKind;
  reason: HeroReason;
  resumeUrl: string | null;
}

/**
 * Hero region payload. `slides[0]` is lead (auto-shown on first paint);
 * subsequent entries via carousel. `null` only when all source pools empty;
 * otherwise `slides.length` 1–6 inclusive.
 */
export interface LayoutHero {
  slides: HeroSlide[];
}

/**
 * Row structure from `getLayout` (no items; use `getRowContent` to load).
 * `rowId` is opaque registry slug (e.g. `"recommendedForYou-tv"`); `kind`
 * determines card layout.
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
 * Detail-modal extra fields on catalog summary. `null` fields omitted from
 * wire so `if (extra.director)` checks work. Plugin-driven, best-effort;
 * missing data hides the row.
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
   * TV season list with episode metadata. Populated when `mediaType === "tv"`
   * and metadata plugin returns season payload; omitted on failure (not null).
   * Per-server availability via `home.getSeasonAvailability` (different cache: day vs. minute).
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
 * `home.getSeasonAvailability` response. `servers` empty when no
 * `libraryAvailability@v1` provider configured (not an error). Per-plugin
 * failures populate `errors[]`; successful servers appear in `servers[]`.
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
