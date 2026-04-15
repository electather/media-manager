import { consola } from "consola";
import type {
  MetadataProvider,
  ActivityProvider,
  DownloadProvider,
  DiscoverFilters,
} from "../integrations/types";
import type { CacheProvider } from "../cache/types";
import type { PreferenceEngine } from "../preferences/engine";
import type {
  MediaItem,
  MediaDetails,
  WatchHistoryEntry,
  WatchlistEntry,
  UpcomingEpisode,
  ShowProgress,
  SearchResult,
} from "./types";
import type { RequestStatus } from "../integrations/types";

/** High-level facade over all media integrations. MCP tools and oRPC procedures call this exclusively. */
export class MediaService {
  constructor(
    _metadata: MetadataProvider,
    _activity: ActivityProvider,
    _downloads: DownloadProvider,
    _cache: CacheProvider,
    _preferences: PreferenceEngine,
  ) {}

  async search(
    _query: string,
    _mediaType?: "movie" | "tv",
    _limit?: number,
  ): Promise<SearchResult[]> {
    consola.debug("MediaService.search", { _query, _mediaType, _limit });
    return [];
  }

  async recommend(_limit?: number): Promise<MediaItem[]> {
    consola.debug("MediaService.recommend", { _limit });
    return [];
  }

  async similar(_id: string, _limit?: number): Promise<MediaItem[]> {
    consola.debug("MediaService.similar", { _id, _limit });
    return [];
  }

  async trending(_mediaType?: "movie" | "tv", _limit?: number): Promise<MediaItem[]> {
    consola.debug("MediaService.trending", { _mediaType, _limit });
    return [];
  }

  async discover(_filters: DiscoverFilters): Promise<MediaItem[]> {
    consola.debug("MediaService.discover", { _filters });
    return [];
  }

  async getDetails(_id: string): Promise<MediaDetails | null> {
    consola.debug("MediaService.getDetails", { _id });
    return null;
  }

  async getWatchlist(_mediaType?: "movie" | "tv"): Promise<WatchlistEntry[]> {
    consola.debug("MediaService.getWatchlist", { _mediaType });
    return [];
  }

  async getHistory(_limit?: number): Promise<WatchHistoryEntry[]> {
    consola.debug("MediaService.getHistory", { _limit });
    return [];
  }

  async getUpcoming(): Promise<UpcomingEpisode[]> {
    consola.debug("MediaService.getUpcoming");
    return [];
  }

  async getProgress(): Promise<ShowProgress[]> {
    consola.debug("MediaService.getProgress");
    return [];
  }

  async requestDownload(
    _id: string,
    _seasons?: string,
  ): Promise<{ success: boolean; message: string }> {
    consola.debug("MediaService.requestDownload", { _id, _seasons });
    return { success: false, message: "Not implemented" };
  }

  async getRequests(): Promise<RequestStatus[]> {
    consola.debug("MediaService.getRequests");
    return [];
  }

  async recordFeedback(
    _id: string,
    _action: "like" | "dislike" | "rate" | "note",
    _rating?: number,
    _note?: string,
  ): Promise<void> {
    consola.debug("MediaService.recordFeedback", { _id, _action, _rating, _note });
  }
}
