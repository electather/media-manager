export const MEDIA_TYPES = ["movie", "tv"] as const;

export const AVAILABILITY_STATUSES = [
  "available",
  "requested",
  "processing",
  "unavailable",
  "unknown",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const MEDIA_ROW_BUCKETS = [
  "ready",
  "in-progress",
  "awaiting",
  "unavailable",
  "upcoming",
] as const;
export type MediaRowBucket = (typeof MEDIA_ROW_BUCKETS)[number];
