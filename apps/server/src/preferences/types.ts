import type { Confidence, FeatureCategory } from "@nama/shared/preferences";
import type { MediaItem } from "@nama/shared/media";

// ─── Public domain types ──────────────────────────────────────────────────

export interface FeatureContribution {
  category: FeatureCategory;
  feature: string;
  weight: number;
}

export interface RankedCandidate {
  item: MediaItem;
  score: number;
  profileScore: number;
  confidence: Confidence;
  topContributors: FeatureContribution[];
  // Feature payload that produced this score. Carrying it on the ranked
  // entry lets `explainRanked` reuse it instead of re-fetching metadata,
  // which would saturate the TMDB rate limit for top-N explanations.
  features: CandidateFeatures;
}

export interface UserItemFeedback {
  rated?: number;
  liked?: boolean;
  noted?: boolean;
  latestAt?: number;
}

/** Common optional metadata fields shared by CandidateFeatures and RawMediaItem. */
export interface MediaItemFields {
  title?: string;
  year?: number | null;
  runtime?: number | null;
  genres?: string[];
  keywords?: string[];
  cast?: string[];
  director?: string | null;
  writers?: string[];
  creators?: string[];
  originalLanguage?: string | null;
}

/**
 * The denormalized shape the feature extractors read. Callers should map
 * whatever metadata they have — plugin MediaItem or the richer MediaDetails —
 * into this before invoking extraction.
 */
export interface CandidateFeatures extends MediaItemFields {
  id: string;
  type: "movie" | "tv";
}

export interface RawMediaItem extends MediaItemFields {
  id?: string;
  type?: "movie" | "tv";
  ids?: { tmdb_id?: string };
}

// ─── Provider data-fetch facade (test seam) ───────────────────────────────

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
