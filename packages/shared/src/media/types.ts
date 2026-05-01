import type {
  AvailabilityStatus,
  EpisodeStatus,
  MediaType,
  SeasonStatus,
  SeriesStatus,
} from "./enums";

export interface MediaImage {
  "16/9"?: string;
  "2/3"?: string;
  "1/1"?: string;
}

export interface MediaProgress {
  watched: number;
  total: number;
}

export interface EpisodeProgress {
  watched: number;
  total: number;
}

export interface UpcomingEpisode {
  season: number;
  episode: number;
  /** Air time in ms epoch. */
  airsAt: number;
  name?: string;
}

export interface StreamLink {
  source: string;
  url?: string;
}

export interface DetailEpisode {
  id: string;
  episode: number;
  title: string;
  /** ISO 8601 date string. */
  airDate: string;
  runtime: number;
  status: EpisodeStatus;
}

export interface DetailSeason {
  id: string;
  title: string;
  episodeCount: number;
  status: SeasonStatus;
  episodes: DetailEpisode[];
  counts?: {
    available?: number;
    requested?: number;
    upcoming?: number;
  };
}

/**
 * Canonical wire shape for a single media entity. Superset that covers both
 * compact (home rows) and full (detail) projections; clients carry the same
 * row regardless of fetch path. `_detailFetchedAt` is a client-only hydration
 * marker — never present on the wire.
 */
export interface MediaDetail {
  /** Composite id, e.g. `"movie:550"` or `"tv:1396"`. */
  id: string;
  tmdbId: string;
  mediaType: MediaType;
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  /** Plain URL string; UI falls back to title text when absent. */
  clearLogo?: string;
  overview?: string;
  /** Top three genres. */
  genres?: string[];
  rating?: number;
  userRating?: number;
  matchReason?: string;
  status?: AvailabilityStatus;
  progress?: MediaProgress;
  episodeProgress?: EpisodeProgress;
  episode?: UpcomingEpisode;
  runtime?: string;
  ageRating?: string;
  votes?: number;
  audienceScore?: number;
  criticScore?: number;
  tags?: string[];
  director?: string;
  cast?: string[];
  streamLink?: StreamLink;
  trailerUrl?: string;
  seriesStatus?: SeriesStatus;
  /** ISO 8601 date string. */
  nextAirDate?: string;
  seasons?: DetailSeason[];
  ratings?: {
    tmdb?: number;
    trakt?: number;
    user?: number;
  };
  streamingOn?: string[];
  keywords?: string[];
}

/**
 * Plugin-side `MediaItem` shape — the output of the metadata capability.
 * Distinct from `MediaDetail` (the client wire shape): plugins emit raw
 * snake-cased ids and nullable fields; the server mapper converts to
 * `MediaDetail` for the client.
 */
export interface MediaItem {
  /** Format: "movie:550" or "tv:1396". */
  id: string;
  title: string;
  year: number;
  type: MediaType;
  genres: string[];
  rating: number | null;
  overview: string;
  posterUrl: string | null;
  status: AvailabilityStatus;
  userRating: number | null;
  matchReason: string | null;
}
