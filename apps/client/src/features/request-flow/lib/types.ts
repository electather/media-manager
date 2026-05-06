// Domain types for the request flow.

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
