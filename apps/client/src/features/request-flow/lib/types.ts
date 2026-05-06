// Domain types for the request flow.

/**
 * Per-episode status the request flow renders. Values map onto the four
 * status chip variants the picker expects; the request-flow feature owns
 * this vocabulary now that the home feed no longer carries seasons[].
 */
export type EpisodeStatus = "available" | "requested" | "unavailable" | "upcoming";

export type Episode = {
  id: string;
  episode: number;
  title: string;
  airDate: string;
  runtime: number;
  status: EpisodeStatus;
};

export type Season = {
  number: number;
  episodeCount: number;
  counts: Partial<Record<EpisodeStatus, number>>;
  episodes: Episode[];
};

export type RequestStatus =
  | "available"
  | "in-progress"
  | "pending"
  | "missing"
  | "partial"
  | "upcoming";

export type UserRole = "user" | "admin";

export type ServiceGlyph = "server" | "stack";

export type RequestProfile = {
  id: string;
  label: string;
  detail: string;
};

export type RequestService = {
  id: string;
  label: string;
  sub: string;
  glyph: ServiceGlyph;
  exposesProfiles: boolean;
  supports: ("movie" | "tv")[];
  profiles: RequestProfile[];
  defaultProfileId: string;
};

export type RequestPayload = {
  itemId: string;
  kind: "movie" | "tv";
  serviceId: string;
  profileId: string | null;
  seasons: number[];
};

export type RequestDestination = {
  service: RequestService | null;
  profile: RequestProfile | null;
  serviceLabel: string;
  profileLabel: string | null;
};
