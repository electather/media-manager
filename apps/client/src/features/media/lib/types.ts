export type MediaKind = "movie" | "tv";

export interface ClearLogo {
  text: string;
  url?: string;
}

export interface MediaImage {
  "16/9"?: string;
  "2/3"?: string;
  "1/1"?: string;
}

export interface MediaProgress {
  watched: number;
  total: number;
}

export interface UpcomingEpisode {
  season: number;
  episode: number;
  airsAt: number;
  name?: string;
}

export interface MediaDetailItem {
  id: string;
  kind: MediaKind;
  title: string;
  clearLogo?: ClearLogo;
  image?: MediaImage;
  year?: number;
  runtime?: string;
  ageRating?: string;
  genres?: string[];
  rating?: number;
  votes?: number;
  audienceScore?: number;
  criticScore?: number;
  tags?: string[];
  overview?: string;
  director?: string;
  cast?: string[];
  matchReason?: string;
  seriesStatus?: "ongoing" | "finished";
  nextAirDate?: string;
  progress?: MediaProgress;
  episode?: UpcomingEpisode;
  streamLink?: { source: string; url?: string };
}

export type EpisodeStatus = "available" | "requested" | "unavailable" | "partial" | "upcoming";

export interface DetailEpisode {
  id: string;
  episode: number;
  title: string;
  airDate: string;
  runtime: number;
  status: EpisodeStatus;
}

export interface DetailSeason {
  id: string;
  title: string;
  episodeCount: number;
  status: EpisodeStatus;
  episodes: DetailEpisode[];
  counts?: {
    available?: number;
    requested?: number;
    upcoming?: number;
  };
}

export type FeedbackVote = "up" | "down" | null;
