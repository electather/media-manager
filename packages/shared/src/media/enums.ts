export const MEDIA_TYPES = ["movie", "tv"] as const;

export const AVAILABILITY_STATUSES = [
  "available",
  "requested",
  "processing",
  "unavailable",
  "unknown",
] as const;

export const SERIES_STATUSES = ["ongoing", "finished"] as const;

export const EPISODE_STATUSES = [
  "available",
  "requested",
  "unavailable",
  "partial",
  "upcoming",
] as const;

export const SEASON_STATUSES = EPISODE_STATUSES;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type SeriesStatus = (typeof SERIES_STATUSES)[number];
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];
export type SeasonStatus = (typeof SEASON_STATUSES)[number];
