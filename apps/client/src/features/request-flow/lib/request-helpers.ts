import type { MediaRequest, RequestTarget } from "@ent-mcp/shared/media";
import type { RequestDestination, RequestStatus, Season } from "./types";

// Wire / mock status aliases mapped to the widened request-flow set. The
// wire format collapses pending and in-progress under `requested`; this map
// reverses that so the UI can mirror the prototype.
const STATUS_ALIAS: Record<string, RequestStatus> = {
  available: "available",
  "in-progress": "in-progress",
  pending: "pending",
  missing: "missing",
  partial: "partial",
  upcoming: "upcoming",
  // wire/legacy aliases
  requested: "in-progress",
  processing: "in-progress",
  unavailable: "missing",
};

export function normalizeRequestStatus(status: string | null | undefined): RequestStatus {
  if (!status) return "available";
  return STATUS_ALIAS[status] ?? "available";
}

/**
 * Builds the tooltip-ready destination from a target + selected profile id.
 * Returns `null` when no target is supplied so the popover can fall back to a
 * neutral message.
 */
export function describeTargetDestination(
  target: RequestTarget | null,
  profileId: string | null,
): RequestDestination {
  if (!target) return { serviceLabel: "—", profileLabel: null };
  const profile = target.profiles.find((p) => p.id === profileId) ?? null;
  return { serviceLabel: target.label, profileLabel: profile?.label ?? null };
}

export type SeasonActionModel =
  | { kind: "request"; status: RequestStatus; label: "Request missing" | "Request season" }
  | { kind: "no-plugin"; status: RequestStatus }
  | { kind: "status"; status: RequestStatus };

function isRequestableStatus(status: RequestStatus): boolean {
  return status === "partial" || status === "missing" || status === "upcoming";
}

export function getSeasonActionModel(
  status: RequestStatus,
  pluginConfigured: boolean,
): SeasonActionModel {
  if (!pluginConfigured) {
    return isRequestableStatus(status) ? { kind: "no-plugin", status } : { kind: "status", status };
  }
  if (status === "partial" || status === "missing") {
    return { kind: "request", status, label: "Request missing" };
  }
  if (status === "upcoming") {
    return { kind: "request", status, label: "Request season" };
  }
  return { kind: "status", status };
}

/**
 * Infer a season-level status from per-episode counts. Mirrors the existing
 * `inferSeasonStatus` from `modal-seasons.tsx` but emits the request-flow's
 * widened status set (`missing` instead of `unavailable`, `in-progress`
 * instead of `requested`).
 */
export function inferSeasonStatus(season: Season): RequestStatus {
  const { counts, episodeCount } = season;
  const available = counts.available ?? 0;
  const requested = counts.requested ?? 0;
  const upcoming = counts.upcoming ?? 0;
  const unavailable = counts.unavailable ?? 0;

  // Order matters: terminal "all-of-a-kind" states win over the partial /
  // residual checks below. Listing them as predicate/result tuples keeps
  // the function shallow without losing readability.
  const matchers: [boolean, RequestStatus][] = [
    [upcoming === episodeCount, "upcoming"],
    [available === episodeCount, "available"],
    [unavailable === episodeCount, "missing"],
    [requested === episodeCount, "in-progress"],
    [available > 0 && available + upcoming <= episodeCount, "partial"],
    [requested > 0, "in-progress"],
  ];
  return matchers.find(([cond]) => cond)?.[1] ?? "missing";
}

/**
 * Strips the `movie:` / `tv:` prefix from a `HomeMediaItem.id` so request
 * payloads carry the bare numeric `tmdbId`. Returns the input unchanged when
 * no prefix is present.
 */
export function tmdbIdFromItemId(itemId: string): string {
  const idx = itemId.indexOf(":");
  return idx === -1 ? itemId : itemId.slice(idx + 1);
}

export function getRequestableSeasonNumbers(
  seasons: { number: number; status: RequestStatus }[],
  pluginConfigured: boolean,
): number[] {
  return seasons
    .filter((s) => getSeasonActionModel(s.status, pluginConfigured).kind === "request")
    .map((s) => s.number);
}

/**
 * Maps a server-side `MediaRequest.status` to the UI request-flow status set.
 * Returns `null` for `failed` rows so the overlay drops and the request button
 * is re-armed.
 */
export function mediaRequestToUiStatus(s: MediaRequest["status"]): RequestStatus | null {
  if (s === "pending" || s === "approved") return "pending";
  if (s === "processing") return "in-progress";
  if (s === "available") return "available";
  return null;
}

/**
 * Picks the user's outstanding request row matching `tmdbId` + `type`, dropping
 * `failed` rows so the UI re-arms the request button. When `seasonNumber` is
 * provided, the row must include that season.
 */
export function selectRequestForMedia(
  items: MediaRequest[] | undefined,
  tmdbId: string,
  type: "movie" | "tv",
  seasonNumber?: number,
): MediaRequest | undefined {
  return items?.find(
    (r) =>
      r.tmdbId === tmdbId &&
      r.type === type &&
      r.status !== "failed" &&
      (seasonNumber === undefined || r.seasons.includes(seasonNumber)),
  );
}
