export type RequestRole = "user" | "admin";

export type RequestStatus = "available" | "unavailable" | "pending" | "in-progress" | "denied";

export type SeasonRequestStatus =
  | "available"
  | "unavailable"
  | "requested"
  | "partial"
  | "upcoming";

export interface ServiceProfile {
  id: string;
  label: string;
}

export interface ServiceDescriptor {
  id: string;
  label: string;
  profiles: ServiceProfile[];
}

export interface RequestDestination {
  serviceId: string;
  profileId: string;
}

export interface DestinationDescriptor {
  serviceId: string;
  profileId: string;
  serviceLabel: string;
  profileLabel: string;
}

export interface StreamLink {
  url?: string;
  source: string;
}

export interface RequestableItem {
  id: string;
  kind: "movie" | "tv";
  title: string;
}

export interface RequestRecord {
  itemId: string;
  status: RequestStatus;
  destination: DestinationDescriptor;
}
