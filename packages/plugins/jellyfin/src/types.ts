import type { PluginContext } from "@nama/plugin-sdk";

export interface JellyfinCreds {
  accessToken: string;
  password: string;
}

// Pure user-scoped plugin: no shared/global config shapes.
export type JellyfinSharedCreds = Record<string, never>;

export interface JellyfinUserCfg {
  externalServerUrl: string;
  internalServerUrl?: string;
  username: string;
  userId?: string;
}

export type JellyfinGlobalCfg = Record<string, never>;

export type Ctx = PluginContext<
  JellyfinCreds,
  JellyfinSharedCreds,
  JellyfinUserCfg,
  JellyfinGlobalCfg
>;

/**
 * Cross-service media item shape returned by capabilities like
 * `playback@v1` and `watchHistory@v1` — distinct from the richer
 * server-local `LibraryItem` that leaks Jellyfin-only fields. Kept at
 * file scope so the two emitters (`getPositions` and `getHistory`)
 * cannot drift.
 */
export interface MediaItemShape {
  id: string;
  title: string;
  year: number | null;
  type: "movie" | "tv";
  genres: string[];
  rating: null;
  overview: string;
  posterUrl: null;
  ids: Record<string, string | undefined>;
}

export interface JellyfinProviderIds {
  Imdb?: string;
  Tmdb?: string;
  Tvdb?: string;
}

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ProductionYear?: number;
  RunTimeTicks?: number;
  DateCreated?: string;
  /**
   * Episode rows reference their parent show via `SeriesId`. The series
   * carries the show-level TMDB id; episodes only carry IMDB/TVDB ids in
   * their own `ProviderIds`. Continue-watching/Next-up callers fetch the
   * series record to backfill the missing TMDB id.
   */
  SeriesId?: string;
  SeriesName?: string;
  UserData?: {
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
    LastPlayedDate?: string;
    Played?: boolean;
  };
  MediaSources?: Array<{
    Size?: number;
    Bitrate?: number;
    MediaStreams?: Array<{
      Type: string;
      Codec?: string;
      Width?: number;
      Height?: number;
      VideoRange?: string;
      VideoRangeType?: string;
    }>;
  }>;
  ProviderIds?: JellyfinProviderIds;
}

export interface JellyfinSession {
  Id: string;
  UserId?: string;
  UserName?: string;
  DeviceName?: string;
  Client?: string;
  NowPlayingItem?: JellyfinItem;
  PlayState?: {
    PositionTicks?: number;
    IsPaused?: boolean;
    PlayMethod?: string;
  };
  TranscodingInfo?: {
    VideoCodec?: string;
    AudioCodec?: string;
    Bitrate?: number;
    IsVideoDirect?: boolean;
    IsAudioDirect?: boolean;
    TranscodeReasons?: string[];
  };
  PlayDuration?: number;
  StartTimeUtc?: string;
}
