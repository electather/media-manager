import type { PluginContext } from "@ent-mcp/plugin-sdk";

export interface JellyfinCreds {
  accessToken: string;
  password: string;
}

export interface JellyfinSharedCreds {}

export interface JellyfinUserCfg {
  externalServerUrl: string;
  internalServerUrl?: string;
  username: string;
  userId?: string;
}

export interface JellyfinGlobalCfg {}

export type Ctx = PluginContext<
  JellyfinCreds,
  JellyfinSharedCreds,
  JellyfinUserCfg,
  JellyfinGlobalCfg
>;

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
