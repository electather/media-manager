import type { ActivityProvider } from "../types";
import type {
  MediaItem,
  WatchHistoryEntry,
  WatchlistEntry,
  ShowProgress,
  UpcomingEpisode,
} from "../../media/types";

export interface TraktClientConfig {
  clientId: string;
  accessToken?: string;
  baseUrl?: string;
}

/** Trakt activity provider. All methods are stubs pending implementation. */
export class TraktClient implements ActivityProvider {
  constructor(_config: TraktClientConfig) {}

  async getWatchHistory(_limit?: number): Promise<WatchHistoryEntry[]> {
    throw new Error("Not implemented");
  }

  async getWatchlist(_mediaType?: "movie" | "tv"): Promise<WatchlistEntry[]> {
    throw new Error("Not implemented");
  }

  async getShowProgress(_traktId: number): Promise<ShowProgress> {
    throw new Error("Not implemented");
  }

  async getUpcoming(): Promise<UpcomingEpisode[]> {
    throw new Error("Not implemented");
  }

  async getRecommendations(_mediaType?: "movie" | "tv"): Promise<MediaItem[]> {
    throw new Error("Not implemented");
  }

  async syncRating(_tmdbId: string, _mediaType: "movie" | "tv", _rating: number): Promise<void> {
    throw new Error("Not implemented");
  }
}
