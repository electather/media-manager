export const MEDIA_TYPES = ["movie", "tv"] as const;

export const AVAILABILITY_STATUSES = [
  "available",
  "requested",
  "processing",
  "unavailable",
  "unknown",
] as const;

/**
 * Coarse row buckets used by server-side media enrichment and watchlist
 * filters. The classifier emits no hidden `"unknown"` tail.
 */
export const MEDIA_ROW_BUCKETS = [
  "ready",
  "in-progress",
  "awaiting",
  "unavailable",
  "upcoming",
] as const;

export const MEDIA_ROW_STATUS_MAP = {
  available: "ready",
  requested: "awaiting",
  // Request-provider `"unavailable"` means "not servable yet" and maps to
  // `awaiting`; it is distinct from the media row bucket `"unavailable"`.
  unavailable: "awaiting",
  processing: "awaiting",
  unknown: undefined,
} as const satisfies Record<AvailabilityStatus, MediaRowBucket | undefined>;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type MediaRowBucket = (typeof MEDIA_ROW_BUCKETS)[number];
