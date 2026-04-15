import type {
  MediaItem,
  MediaDetails,
  SearchResult,
  WatchHistoryEntry,
  WatchlistEntry,
  ShowProgress,
  UpcomingEpisode,
} from "../media/types";

export interface MetadataProvider {
  search(query: string, mediaType?: "movie" | "tv"): Promise<SearchResult[]>;
  getDetails(id: string, mediaType: "movie" | "tv"): Promise<MediaDetails>;
  getSimilar(id: string, mediaType: "movie" | "tv"): Promise<MediaItem[]>;
  getRecommendations(id: string, mediaType: "movie" | "tv"): Promise<MediaItem[]>;
  getTrending(mediaType?: "movie" | "tv"): Promise<MediaItem[]>;
  discover(filters: DiscoverFilters): Promise<MediaItem[]>;
}

export interface ActivityProvider {
  getWatchHistory(limit?: number): Promise<WatchHistoryEntry[]>;
  getWatchlist(mediaType?: "movie" | "tv"): Promise<WatchlistEntry[]>;
  getShowProgress(traktId: number): Promise<ShowProgress>;
  getUpcoming(): Promise<UpcomingEpisode[]>;
  getRecommendations(mediaType?: "movie" | "tv"): Promise<MediaItem[]>;
  syncRating(tmdbId: string, mediaType: "movie" | "tv", rating: number): Promise<void>;
}

export interface DownloadProvider {
  getAvailability(tmdbId: string, mediaType: "movie" | "tv"): Promise<AvailabilityStatus>;
  createRequest(
    tmdbId: string,
    mediaType: "movie" | "tv",
    seasons?: string,
  ): Promise<RequestResult>;
  getRequests(): Promise<RequestStatus[]>;
}

export interface DiscoverFilters {
  genres?: string[];
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  limit?: number;
}

export type AvailabilityStatus =
  | "available"
  | "requested"
  | "processing"
  | "unavailable"
  | "unknown";

export interface RequestResult {
  success: boolean;
  requestId?: string;
  message?: string;
}

export interface RequestStatus {
  id: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  title: string;
  status: "pending" | "approved" | "processing" | "available" | "failed";
  createdAt: string;
}
