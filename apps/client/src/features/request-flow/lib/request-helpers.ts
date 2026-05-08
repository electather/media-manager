import type { RequestTarget } from "@ent-mcp/shared/media";
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
  | { kind: "status"; status: RequestStatus };

export function getSeasonActionModel(
  status: RequestStatus,
  pluginConfigured: boolean,
): SeasonActionModel {
  if (!pluginConfigured) return { kind: "status", status };
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

export function getRequestableSeasonNumbers(
  seasons: { number: number; status: RequestStatus }[],
  pluginConfigured: boolean,
): number[] {
  return seasons
    .filter((s) => getSeasonActionModel(s.status, pluginConfigured).kind === "request")
    .map((s) => s.number);
}
