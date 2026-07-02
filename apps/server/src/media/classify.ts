import type { CompactMediaItem } from "@nama/shared/home";
import { MEDIA_ROW_STATUS_MAP, type MediaRowBucket } from "@nama/shared/media";
import type { MatchingServer } from "./types";
import { buildFacets } from "./internal/facets";
import type { ProgressEntry, ProgressMap } from "./progress";

export function isActiveProgress(progress: ProgressEntry | undefined): boolean {
  if (!progress) return false;
  if (progress.total <= 0) return false;
  return progress.watched > 0 && progress.watched < progress.total;
}

/** Server-side mirror of client's classifier (apps/client/.../classify.ts); kept in lockstep for `?bucket=` match.
 * #502: `"upcoming"` reserved for unreleased only; info-only released rows fall to `"unavailable"`.
 */
// fallow-ignore-next-line complexity
export function classifyBucket(
  item: Pick<CompactMediaItem, "status" | "availability" | "facets" | "progress">,
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

/** Shared preview shape for `enrich` pre-pass and `classifyRows`; prevents caller drift on bucket derivation. */
/**
 * Single source of truth for the requestEligible signal: no local copy, not already available,
 * and at least one request provider registered. Missing any check caused #903.
 */
export function isRequestEligible(
  servers: MatchingServer[],
  status: CompactMediaItem["status"],
  requestProviderCount: number,
): boolean {
  return servers.length === 0 && status !== "available" && requestProviderCount > 0;
}

// fallow-ignore-next-line complexity
export function previewForClassify(
  meta: PreviewMeta | undefined,
  rawStatus: string | undefined,
  servers: MatchingServer[],
  progress?: ProgressEntry,
  requestProviderCount = 0,
): Pick<CompactMediaItem, "status" | "availability" | "facets" | "progress"> {
  const status: CompactMediaItem["status"] =
    servers.length > 0 ? "available" : ((rawStatus ?? "unknown") as CompactMediaItem["status"]);
  const facets = buildFacets(meta ?? {});
  return {
    status,
    availability: {
      hasAnyServerCopy: servers.length > 0,
      requestEligible: isRequestEligible(servers, status, requestProviderCount),
      servers: servers.map((s) => ({ id: s.id, label: s.label })),
    },
    ...(Object.keys(facets).length > 0 ? { facets } : {}),
    ...(progress ? { progress } : {}),
  };
}

export type { ProgressEntry, ProgressMap };
