import type { CandidateFeatures } from "../types";
import type {
  PreferenceDataProvider,
  HistorySignal,
  RatingSignal,
  WatchlistSignal,
  CommentSignal,
} from "../provider";

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
