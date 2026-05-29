// fallow-ignore-file unused-file
// Utility kept per 2026-05-23-watchlist-sections-design §C.4 — components
// consuming totalRuntimeMinutes / splitRuntime land in Phase 2-3 of that design.
import type { WatchlistBuckets, WatchlistItem, WatchlistStatus } from "./types";

const STATUS_MAP: Record<NonNullable<WatchlistItem["status"]>, WatchlistStatus | undefined> = {
  available: "available",
  requested: "requested",
  unavailable: "unavailable",
  processing: "requested",
  unknown: undefined,
};

function isInfoOnly(item: WatchlistItem): boolean {
  const a = item.availability;
  return Boolean(a && !a.hasAnyServerCopy && !a.requestEligible);
}

// fallow-ignore-next-line complexity
export function classifyStatus(item: WatchlistItem): WatchlistStatus {
  if (item.progress) return "in-progress";
  const fromStatus = item.status ? STATUS_MAP[item.status] : undefined;
  if (fromStatus) return fromStatus;
  if (item.facets?.releaseDate) return "upcoming";
  // Info-only titles (no library copy, not request-eligible) cannot be acted
  // on, so the server `/counts` + `?bucket=` routes them to `unavailable`
  // (#502). The client classifier mirrors that so the local bucket view
  // matches the server-rendered counts; routing info-only → `upcoming` here
  // would diverge from the server response for the same row.
  if (isInfoOnly(item)) return "unavailable";
  return "unknown";
}

// Items classified as "unknown" are intentionally omitted — no bucket entry
// here, so they drop out of bucketize and are excluded from header counts.
const STATUS_TO_BUCKET: Partial<Record<WatchlistStatus, keyof WatchlistBuckets>> = {
  "in-progress": "inProgress",
  available: "available",
  requested: "requested",
  unavailable: "unavailable",
  upcoming: "upcoming",
};

export function bucketize(items: readonly WatchlistItem[]): WatchlistBuckets {
  const out: WatchlistBuckets = {
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

const TV_FALLBACK_RUNTIME = 48;
const TV_FALLBACK_EPISODE_COUNT = 8;
const MOVIE_FALLBACK_RUNTIME = 110;

// fallow-ignore-next-line complexity
function itemRuntimeMinutes(item: WatchlistItem): number {
  const min = item.facets?.runtimeMin;
  if (item.mediaType === "tv") {
    const eps = item.facets?.episodeCount ?? TV_FALLBACK_EPISODE_COUNT;
    return (min ?? TV_FALLBACK_RUNTIME) * eps;
  }
  return min ?? MOVIE_FALLBACK_RUNTIME;
}

export function totalRuntimeMinutes(items: readonly WatchlistItem[]): number {
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
