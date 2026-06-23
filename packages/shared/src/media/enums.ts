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

// The one source-id set client and server agree on (design §A5). Generic resolver
// dispatches GET /api/media/sources/:sourceId; client ClientMediaSource keys off same.
// Includes home rows and watchlist sources; watchlist buckets ride watchlist-items
// via bucket param (no per-bucket ids, matching server ItemsParams).
export const MEDIA_SOURCE_IDS = [
  // Home rows.
  "recommendedForYou-tv",
  "recommendedForYou-movies",
  "continueWatching-active",
  "continueWatching-next",
  "becauseYouWatched",
  "similarTo",
  "yourWatchlist",
  "upcomingForYou",
  "trendingNow",
  "newReleases",
  // Watchlist sections.
  "watchlist-items",
  "watchlist-mood-items",
  "watchlist-tonight",
  "watchlist-recently",
  // Library item lenses (served through the unified resolver). The franchise
  // (`collections`) lens is NOT here — it is a group-first endpoint, not a
  // `Page` source, so it has its own `/api/library/collections` route. The
  // `server`/`quality` lenses expand a title once per server / quality tier via
  // `json_each`, so the same title can repeat across sections of one page.
  "library-az",
  "library-timeline",
  "library-server",
  "library-quality",
] as const;

export type MediaSourceId = (typeof MEDIA_SOURCE_IDS)[number];
