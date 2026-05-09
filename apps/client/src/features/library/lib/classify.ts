import type { LibraryBuckets, LibraryCounts, LibraryItem, LibraryStatus } from "./types";

export function classifyStatus(item: LibraryItem): LibraryStatus {
  if (item.progress) return "in-progress";
  if (item.status === "unavailable") return "unavailable";
  if (item.status === "requested") return "requested";
  if (item.status === "available") return "available";
  if (item.facets?.releaseDate) return "upcoming";
  if (
    item.availability &&
    !item.availability.hasAnyServerCopy &&
    !item.availability.requestEligible
  ) {
    return "upcoming";
  }
  return "unknown";
}

export function bucketize(items: readonly LibraryItem[]): LibraryBuckets {
  const out: LibraryBuckets = {
    available: [],
    inProgress: [],
    requested: [],
    unavailable: [],
    upcoming: [],
  };
  for (const it of items) {
    const c = classifyStatus(it);
    if (c === "in-progress") out.inProgress.push(it);
    else if (c === "available") out.available.push(it);
    else if (c === "requested") out.requested.push(it);
    else if (c === "unavailable") out.unavailable.push(it);
    else if (c === "upcoming") out.upcoming.push(it);
  }
  return out;
}

export function deriveCounts(buckets: LibraryBuckets): LibraryCounts {
  return {
    ready: buckets.available.length + buckets.inProgress.length,
    inProgress: buckets.inProgress.length,
    awaiting: buckets.requested.length + buckets.unavailable.length,
    upcoming: buckets.upcoming.length,
  };
}

const TV_FALLBACK_RUNTIME = 48;
const TV_FALLBACK_EPISODE_COUNT = 8;
const MOVIE_FALLBACK_RUNTIME = 110;

export function totalRuntimeMinutes(items: readonly LibraryItem[]): number {
  let total = 0;
  for (const it of items) {
    const min = it.facets?.runtimeMin;
    if (typeof min === "number") {
      total +=
        it.mediaType === "tv" ? min * (it.facets?.episodeCount ?? TV_FALLBACK_EPISODE_COUNT) : min;
    } else if (it.mediaType === "tv") {
      total += TV_FALLBACK_RUNTIME * TV_FALLBACK_EPISODE_COUNT;
    } else {
      total += MOVIE_FALLBACK_RUNTIME;
    }
  }
  return total;
}

export interface FormattedRuntime {
  days: number;
  hours: number;
}

export function splitRuntime(min: number): FormattedRuntime {
  const days = Math.floor(min / (60 * 24));
  const hours = Math.floor((min % (60 * 24)) / 60);
  return { days, hours };
}
