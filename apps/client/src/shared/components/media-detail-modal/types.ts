import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { MockEpisode, MockSeason } from "@/features/home/lib/types";

export type { MockEpisode as EpisodeData, MockSeason as SeasonData };
export type EpisodeStatus = MockEpisode["status"];

export type MediaDetailItem = CompactMediaItem & {
  clearLogoText?: string;
  runtime?: string;
  ageRating?: string;
  cast?: string[];
  director?: string;
  audienceScore?: number;
  criticScore?: number;
  votes?: number;
  tags?: string[];
  trailerUrl?: string;
  seriesStatus?: "ongoing" | "finished";
  nextAirDate?: string;
  seasons?: MockSeason[];
};
