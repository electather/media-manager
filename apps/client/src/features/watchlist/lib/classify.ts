import type { WatchlistBuckets, WatchlistCounts, WatchlistItem, WatchlistStatus } from "./types";

/**
 * Maps a watchlist item to the section bucket it should live in. Mirrors the
 * prototype's heuristic: progress wins, then explicit `status`, then the
 * presence of a release date promotes the item to "upcoming".
 */
export function classifyStatus(item: WatchlistItem): WatchlistStatus {
  if (item.progress) return "in-progress";
  if (item.status === "unavailable") return "unavailable";
  if (item.status === "requested") return "requested";
  if (item.status === "available") return "available";
  if (item.facets?.releaseDate || item.relDate) return "upcoming";
  if (
    item.availability &&
    !item.availability.hasAnyServerCopy &&
    !item.availability.requestEligible
  )
    return "upcoming";
  return "available";
}

export function bucketize(items: readonly WatchlistItem[]): WatchlistBuckets {
  const buckets: WatchlistBuckets = {
    available: [],
    inProgress: [],
    requested: [],
    unavailable: [],
    upcoming: [],
  };
  for (const it of items) {
    const status = classifyStatus(it);
    if (status === "in-progress") buckets.inProgress.push(it);
    else if (status === "available") buckets.available.push(it);
    else if (status === "requested") buckets.requested.push(it);
    else if (status === "unavailable") buckets.unavailable.push(it);
    else if (status === "upcoming") buckets.upcoming.push(it);
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
