import type { WatchlistBucket, WatchlistItem } from "@ent-mcp/shared/watchlist";
import type { MatchingServer } from "../media";
import type { ProgressEntry } from "./progress";

/**
 * Server-side mirror of the client's classifier (see
 * `apps/client/src/features/watchlist/lib/classify.ts`). Kept in lockstep so
 * `/counts` and `?bucket=` decisions match what the client would draw from
 * the same row. Rev 6: every row classifies into one of the five visible
 * buckets — the prior `"unknown"` tail is rolled into `"unavailable"`.
 */
export type ClassifiedBucket = WatchlistBucket;

// Request-provider status `"unavailable"` ("not servable yet") maps to the
// `awaiting` bucket. Distinct from the *bucket* `"unavailable"` (no server,
// no request) — see design name-collision note.
const STATUS_MAP: Record<NonNullable<WatchlistItem["status"]>, ClassifiedBucket | undefined> = {
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

export function isActiveProgress(progress: ProgressEntry | undefined): boolean {
  if (!progress) return false;
  if (progress.total <= 0) return false;
  return progress.watched > 0 && progress.watched < progress.total;
}

// fallow-ignore-next-line complexity
export function classifyBucket(
  item: Pick<WatchlistItem, "status" | "availability" | "facets" | "progress">,
): ClassifiedBucket {
  if (isActiveProgress(item.progress)) return "in-progress";
  const fromStatus = item.status ? STATUS_MAP[item.status] : undefined;
  if (fromStatus) return fromStatus;
  if (item.facets?.releaseDate || isInfoOnly(item)) return "upcoming";
  return "unavailable";
}

export function matchesBucket(classified: ClassifiedBucket, target: WatchlistBucket): boolean {
  return classified === target;
}

export interface PreviewMeta {
  year?: number | null;
  runtimeMinutes?: number | null;
}

/**
 * Cheap-signal preview of a `WatchlistItem` shared by `enrich`'s filter
 * pre-pass and the `/counts` aggregator. Both paths derive the same bucket
 * from `(meta, status, matching servers, progress)` — extracting the shape
 * here keeps the two callers from drifting.
 */
// fallow-ignore-next-line complexity
export function previewForClassify(
  meta: PreviewMeta | undefined,
  rawStatus: string | undefined,
  servers: MatchingServer[],
  progress?: ProgressEntry,
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
      requestEligible: servers.length === 0,
      servers: servers.map((s) => ({ id: s.id, label: s.label })),
    },
    ...(Object.keys(facets).length > 0 ? { facets } : {}),
    ...(progress ? { progress } : {}),
  };
}
