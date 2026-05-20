import type { WatchlistItem, WatchlistListFilter } from "@ent-mcp/shared/watchlist";
import type { MatchingServer } from "../media";

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

export interface PreviewMeta {
  year?: number | null;
  runtimeMinutes?: number | null;
}

/**
 * Cheap-signal preview of a `WatchlistItem` shared by `enrich`'s filter
 * pre-pass and the `/counts` aggregator. Both paths derive the same bucket
 * from `(meta, status, matching servers)` — extracting the shape here keeps
 * the two callers from drifting.
 */
// fallow-ignore-next-line complexity
export function previewForClassify(
  meta: PreviewMeta | undefined,
  rawStatus: string | undefined,
  servers: MatchingServer[],
): Pick<WatchlistItem, "status" | "availability" | "facets" | "progress"> {
  const status: WatchlistItem["status"] =
    servers.length > 0 ? "available" : ((rawStatus ?? "unknown") as WatchlistItem["status"]);
  const facets: NonNullable<WatchlistItem["facets"]> = {};
  if (meta?.runtimeMinutes != null) facets.runtimeMin = meta.runtimeMinutes;
  if (meta?.year != null && meta.year > new Date().getUTCFullYear()) {
    facets.releaseDate = String(meta.year);
  }
  return {
    status,
    availability: {
      hasAnyServerCopy: servers.length > 0,
      requestEligible: servers.length === 0 && status !== "available",
      servers: servers.map((s) => ({ id: s.id, label: s.label })),
    },
    ...(Object.keys(facets).length > 0 ? { facets } : {}),
  };
}
