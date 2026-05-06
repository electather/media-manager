import type { MockSeason } from "@/features/home/lib/types";
import { SERVICES } from "./mock-services";
import type {
  RequestDestination,
  RequestPayload,
  RequestProfile,
  RequestService,
  RequestStatus,
} from "./types";

/**
 * Translate the wire / mock status enum into the richer set used by the
 * request flow. The wire format collapses pending and in-progress under
 * `requested`; this widens it back so the UI can mirror the prototype.
 */
export function normalizeRequestStatus(status: string | null | undefined): RequestStatus {
  if (!status) return "available";
  if (status === "requested" || status === "processing") return "in-progress";
  if (status === "unavailable") return "missing";
  if (
    status === "available" ||
    status === "in-progress" ||
    status === "pending" ||
    status === "missing" ||
    status === "partial" ||
    status === "upcoming"
  ) {
    return status;
  }
  return "available";
}

export function servicesForKind(kind: "movie" | "tv"): RequestService[] {
  const filtered = SERVICES.filter((s) => s.supports.includes(kind));
  return filtered.length > 0 ? filtered : SERVICES;
}

export type RequestSelection = {
  services: RequestService[];
  service: RequestService | null;
  profile: RequestProfile | null;
  serviceId: string | null;
  profileId: string | null;
};

export function resolveRequestSelection(
  kind: "movie" | "tv",
  serviceId: string | undefined,
  profileId: string | undefined,
): RequestSelection {
  const services = servicesForKind(kind);
  const service = services.find((s) => s.id === serviceId) ?? services[0] ?? null;
  const profile =
    service?.profiles.find((p) => p.id === profileId) ??
    service?.profiles.find((p) => p.id === service.defaultProfileId) ??
    null;
  return {
    services,
    service,
    profile,
    serviceId: service?.id ?? null,
    profileId: profile?.id ?? null,
  };
}

export function describeDestination(
  kind: "movie" | "tv",
  serviceId: string | undefined,
  profileId: string | undefined,
): RequestDestination {
  const selection = resolveRequestSelection(kind, serviceId, profileId);
  return {
    service: selection.service,
    profile: selection.profile,
    serviceLabel: selection.service?.label ?? "—",
    profileLabel: selection.profile?.label ?? null,
  };
}

export function createRequestPayload({
  itemId,
  kind,
  serviceId,
  profileId,
  seasonNumbers = [],
}: {
  itemId: string;
  kind: "movie" | "tv";
  serviceId: string;
  profileId: string | null;
  seasonNumbers?: number[];
}): RequestPayload {
  return {
    itemId,
    kind,
    serviceId,
    profileId,
    seasons: kind === "tv" ? [...seasonNumbers] : [],
  };
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
export function inferSeasonStatus(season: MockSeason): RequestStatus {
  const { counts, episodeCount } = season;
  const available = counts.available ?? 0;
  const requested = counts.requested ?? 0;
  const upcoming = counts.upcoming ?? 0;
  const unavailable = counts.unavailable ?? 0;

  if (upcoming === episodeCount) return "upcoming";
  if (available === episodeCount) return "available";
  if (unavailable === episodeCount) return "missing";
  if (requested === episodeCount) return "in-progress";
  if (available > 0 && available + upcoming <= episodeCount) return "partial";
  if (requested > 0) return "in-progress";
  return "missing";
}

export function getRequestableSeasonNumbers(
  seasons: { number: number; status: RequestStatus }[],
  pluginConfigured: boolean,
): number[] {
  return seasons
    .filter((s) => getSeasonActionModel(s.status, pluginConfigured).kind === "request")
    .map((s) => s.number);
}
