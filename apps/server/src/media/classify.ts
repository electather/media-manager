import { MEDIA_ROW_STATUS_MAP, type MediaRowBucket } from "@ent-mcp/shared/media";
import type { WatchlistItem } from "@ent-mcp/shared/watchlist";
import type { MatchingServer } from "./types";
import type { ProgressEntry, ProgressMap } from "./progress";

export function isActiveProgress(progress: ProgressEntry | undefined): boolean {
  if (!progress) return false;
  if (progress.total <= 0) return false;
  return progress.watched > 0 && progress.watched < progress.total;
}

/**
 * Server-side mirror of the client's classifier (see
 * `apps/client/src/features/watchlist/lib/classify.ts`). Kept in lockstep so
 * `/counts` and `?bucket=` decisions match what the client would draw from
 * the same row. Rev 6: every row classifies into one of the five visible
 * buckets — the prior `"unknown"` tail is rolled into `"unavailable"`.
 *
 * #502: `"upcoming"` is reserved for unreleased titles only (a future
 * `releaseDate`). Info-only rows — released, no server copy, and not on a
 * request path — fall through to `"unavailable"` rather than being mistaken
 * for upcoming.
 */
// fallow-ignore-next-line complexity
export function classifyBucket(
  item: Pick<WatchlistItem, "status" | "availability" | "facets" | "progress">,
): MediaRowBucket {
  if (isActiveProgress(item.progress)) return "in-progress";
  const fromStatus = item.status ? MEDIA_ROW_STATUS_MAP[item.status] : undefined;
  if (fromStatus) return fromStatus;
  if (item.facets?.releaseDate) return "upcoming";
  return "unavailable";
}

export function matchesBucket(classified: MediaRowBucket, target: MediaRowBucket): boolean {
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

export type { ProgressEntry, ProgressMap };
