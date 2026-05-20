import type { WatchlistItem, WatchlistListFilter } from "@ent-mcp/shared/watchlist";

/**
 * Server-side mirror of the client's classifier (see
 * `apps/client/src/features/watchlist/lib/classify.ts`). Kept in lockstep so
 * `/counts` and `?filter=` decisions match what the client would draw from
 * the same row. The bucket set is intentionally simpler than the client's —
 * the wire-side filter folds `in-progress` into `ready`.
 */
export type WatchlistBucket = "ready" | "awaiting" | "upcoming" | "unknown";

const STATUS_MAP: Record<NonNullable<WatchlistItem["status"]>, WatchlistBucket | undefined> = {
  available: "ready",
  requested: "awaiting",
  unavailable: "awaiting",
  processing: "awaiting",
  unknown: undefined,
};

function isInfoOnly(item: Pick<WatchlistItem, "availability">): boolean {
  const a = item.availability;
  return Boolean(a && !a.hasAnyServerCopy && !a.requestEligible);
}

// fallow-ignore-next-line complexity
export function classifyBucket(
  item: Pick<WatchlistItem, "status" | "availability" | "facets" | "progress">,
): WatchlistBucket {
  if (item.progress) return "ready";
  const fromStatus = item.status ? STATUS_MAP[item.status] : undefined;
  if (fromStatus) return fromStatus;
  if (item.facets?.releaseDate || isInfoOnly(item)) return "upcoming";
  return "unknown";
}

export function matchesFilter(bucket: WatchlistBucket, filter: WatchlistListFilter): boolean {
  return bucket === filter;
}
