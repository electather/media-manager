import type { CompactMediaItem } from "@ent-mcp/shared/home";

// Scaffolding for fields the detail-fetch endpoint will populate. None of these
// are present on `CompactMediaItem` today, so the modal sub-sections that read
// them currently render as no-ops. Wire these through once the detail-fetch
// type lands (tracked in the home-feed/detail-modal design doc follow-up).
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
  seasons?: Array<{ number: number; episodeCount?: number }>;
};
