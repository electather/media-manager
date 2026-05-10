import type { LibraryBuckets, LibraryCounts, LibraryItem, LibraryStatus } from "./types";

const STATUS_MAP: Record<NonNullable<LibraryItem["status"]>, LibraryStatus | undefined> = {
  available: "available",
  requested: "requested",
  unavailable: "unavailable",
  processing: "requested",
  unknown: undefined,
};

function isInfoOnly(item: LibraryItem): boolean {
  const a = item.availability;
  return Boolean(a && !a.hasAnyServerCopy && !a.requestEligible);
}

// fallow-ignore-next-line complexity
export function classifyStatus(item: LibraryItem): LibraryStatus {
  if (item.progress) return "in-progress";
  const fromStatus = item.status ? STATUS_MAP[item.status] : undefined;
  if (fromStatus) return fromStatus;
  if (item.facets?.releaseDate || isInfoOnly(item)) return "upcoming";
  return "unknown";
}

// Items classified as "unknown" are intentionally omitted — no bucket entry
// here, so they drop out of bucketize and are excluded from header counts.
const STATUS_TO_BUCKET: Partial<Record<LibraryStatus, keyof LibraryBuckets>> = {
  "in-progress": "inProgress",
  available: "available",
  requested: "requested",
  unavailable: "unavailable",
  upcoming: "upcoming",
};

export function bucketize(items: readonly LibraryItem[]): LibraryBuckets {
  const out: LibraryBuckets = {
    available: [],
    inProgress: [],
    requested: [],
    unavailable: [],
    upcoming: [],
  };
  for (const it of items) {
    const bucket = STATUS_TO_BUCKET[classifyStatus(it)];
    if (bucket) out[bucket].push(it);
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

// fallow-ignore-next-line complexity
function itemRuntimeMinutes(item: LibraryItem): number {
  const min = item.facets?.runtimeMin;
  if (item.mediaType === "tv") {
    const eps = item.facets?.episodeCount ?? TV_FALLBACK_EPISODE_COUNT;
    return (min ?? TV_FALLBACK_RUNTIME) * eps;
  }
  return min ?? MOVIE_FALLBACK_RUNTIME;
}

export function totalRuntimeMinutes(items: readonly LibraryItem[]): number {
  let total = 0;
  for (const it of items) total += itemRuntimeMinutes(it);
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
