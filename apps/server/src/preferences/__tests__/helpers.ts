import type {
  CandidateFeatures,
  CommentSignal,
  HistorySignal,
  PreferenceDataProvider,
  RatingSignal,
  WatchlistSignal,
} from "../types";

export abstract class NullPreferenceDataProvider implements PreferenceDataProvider {
  abstract getItemFeatures(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<CandidateFeatures | null>;
  async getHistory(): Promise<HistorySignal[]> {
    return [];
  }
  async getAllRatings(): Promise<RatingSignal[]> {
    return [];
  }
  async getWatchlist(): Promise<WatchlistSignal[]> {
    return [];
  }
  async getComments(): Promise<CommentSignal[]> {
    return [];
  }
}
