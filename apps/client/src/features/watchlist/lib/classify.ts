import type { WatchlistBuckets, WatchlistCounts, WatchlistItem, WatchlistStatus } from "./types";

/** Items the wire layer flagged with an explicit status fall straight through. */
const EXPLICIT_STATUS: Partial<Record<NonNullable<WatchlistItem["status"]>, WatchlistStatus>> = {
  unavailable: "unavailable",
  requested: "requested",
  available: "available",
};

// fallow-ignore-next-line complexity
function isUpcoming(item: WatchlistItem): boolean {
  if (item.facets?.releaseDate) return true;
  if (item.relDate) return true;
  const a = item.availability;
  return Boolean(a && !a.hasAnyServerCopy && !a.requestEligible);
}

/**
 * Maps a watchlist item to the section bucket it should live in. Mirrors the
 * prototype's heuristic: progress wins, then explicit `status`, then the
 * presence of a release date promotes the item to "upcoming".
 */
// fallow-ignore-next-line complexity
export function classifyStatus(item: WatchlistItem): WatchlistStatus {
  if (item.progress) return "in-progress";
  const explicit = item.status ? EXPLICIT_STATUS[item.status] : undefined;
  if (explicit) return explicit;
  if (isUpcoming(item)) return "upcoming";
  return "available";
}

const BUCKET_KEY: Record<WatchlistStatus, keyof WatchlistBuckets> = {
  "in-progress": "inProgress",
  available: "available",
  requested: "requested",
  unavailable: "unavailable",
  upcoming: "upcoming",
};

export function bucketize(items: readonly WatchlistItem[]): WatchlistBuckets {
  const buckets: WatchlistBuckets = {
    available: [],
    inProgress: [],
    requested: [],
    unavailable: [],
    upcoming: [],
  };
  for (const it of items) {
    buckets[BUCKET_KEY[classifyStatus(it)]].push(it);
  }
  return buckets;
}

export function countsFor(buckets: WatchlistBuckets): WatchlistCounts {
  return {
    available: buckets.available.length + buckets.inProgress.length,
    inProgress: buckets.inProgress.length,
    requested: buckets.requested.length,
    unavailable: buckets.unavailable.length,
    upcoming: buckets.upcoming.length,
  };
}
