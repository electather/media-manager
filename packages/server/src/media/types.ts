import type { AvailabilityStatus } from "../integrations/types";

export interface MediaItem {
  /** Format: "movie:550" or "tv:1396". */
  id: string;
  title: string;
  year: number;
  type: "movie" | "tv";
  genres: string[];
  rating: number | null;
  overview: string;
  posterUrl: string | null;
  status: AvailabilityStatus;
  userRating: number | null;
  matchReason: string | null;
}

export interface MediaDetails extends MediaItem {
  runtime: number | null;
  director: string | null;
  /** Top 3 cast members. */
  cast: string[];
  ratings: {
    tmdb: number | null;
    trakt: number | null;
    user: number | null;
  };
  trailerUrl: string | null;
  streamingOn: string[];
  watchProgress: WatchProgress | null;
  /** Top 8 keywords. */
  keywords: string[];
}

export interface WatchProgress {
  /** Human-readable completed range, e.g. "S1-S3". */
  completed: string;
  /** Next episode identifier, e.g. "S4E01". Null if fully up to date. */
  next: string | null;
  airedTotal: number;
  watchedTotal: number;
}

export interface WatchHistoryEntry {
  id: string;
  mediaItem: MediaItem;
  watchedAt: string;
  progress: number | null;
}

export interface WatchlistEntry {
  id: string;
  mediaItem: MediaItem;
  addedAt: string;
}

export interface ShowProgress {
  showId: string;
  title: string;
  seasons: SeasonProgress[];
  nextEpisode: EpisodeRef | null;
}

export interface SeasonProgress {
  number: number;
  aired: number;
  completed: number;
}

export interface EpisodeRef {
  season: number;
  episode: number;
  title: string;
  airedAt: string | null;
}

export interface UpcomingEpisode {
  showId: string;
  showTitle: string;
  episode: EpisodeRef;
}

export interface SearchResult {
  item: MediaItem;
  score: number;
}
