import type { CompactMediaItem } from "@ent-mcp/shared/home";

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
};
