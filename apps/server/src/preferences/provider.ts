import type { CandidateFeatures, MediaItemFields } from "./types";

/**
 * Narrow facade the engine depends on. Keeps the engine decoupled from the
 * concrete MediaService and makes rebuild/incremental trivially testable with
 * in-memory fixtures.
 */
export interface PreferenceDataProvider {
  getItemFeatures(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<CandidateFeatures | null>;

  getHistory(userId: string): Promise<HistorySignal[]>;

  getAllRatings(userId: string): Promise<RatingSignal[]>;

  getWatchlist(userId: string): Promise<WatchlistSignal[]>;

  getComments(userId: string): Promise<CommentSignal[]>;
}

export interface HistorySignal {
  tmdbId: string;
  mediaType: "movie" | "tv";
  watchedAt: number;
  progress: number | null;
}

export interface RatingSignal {
  tmdbId: string;
  mediaType: "movie" | "tv";
  rating: number;
  ratedAt: number;
}

export interface WatchlistSignal {
  tmdbId: string;
  mediaType: "movie" | "tv";
  addedAt: number;
}

export interface CommentSignal {
  tmdbId: string;
  mediaType: "movie" | "tv";
  text: string;
  createdAt: number;
}

export interface RawMediaItem extends MediaItemFields {
  id?: string;
  type?: "movie" | "tv";
  ids?: { tmdb_id?: string };
}

/**
 * Normalizes an arbitrary plugin-shaped media item into the `CandidateFeatures`
 * projection. Plugins disagree on field naming, so the adapter stays defensive.
 */
export function rawItemToCandidateFeatures(source: RawMediaItem): CandidateFeatures | null {
  const tmdbId = source.ids?.tmdb_id ?? extractIdFromCombined(source.id);
  const type = source.type ?? inferTypeFromCombined(source.id);
  if (!tmdbId || !type) return null;
  return {
    id: `${type}:${tmdbId}`,
    type,
    title: source.title,
    year: source.year ?? null,
    runtime: source.runtime ?? null,
    genres: source.genres ?? [],
    keywords: source.keywords ?? [],
    cast: source.cast ?? [],
    director: source.director ?? null,
    writers: source.writers ?? [],
    creators: source.creators ?? [],
    originalLanguage: source.originalLanguage ?? null,
  };
}

function extractIdFromCombined(combined: string | undefined): string | undefined {
  if (!combined) return undefined;
  const [, id] = combined.split(":");
  return id;
}

function inferTypeFromCombined(combined: string | undefined): "movie" | "tv" | undefined {
  if (!combined) return undefined;
  const [type] = combined.split(":");
  return type === "movie" || type === "tv" ? type : undefined;
}
