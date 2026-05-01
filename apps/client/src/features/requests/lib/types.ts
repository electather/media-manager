export type RequestRole = "user" | "admin";

export type RequestStatus = "available" | "unavailable" | "pending" | "in-progress" | "denied";

export type SeasonRequestStatus =
  | "available"
  | "unavailable"
  | "requested"
  | "partial"
  | "upcoming";

export type DisplaySeasonStatus =
  | "available"
  | "unavailable"
  | "in-progress"
  | "pending"
  | "partial"
  | "upcoming";

export type SeasonOverrideStatus = "pending" | "in-progress" | "available";

export interface RequestableEpisode {
  id: string;
  episode: number;
  title: string;
  airDate: string;
  runtime: number;
  status: SeasonRequestStatus;
}

export interface RequestableSeason {
  id: string;
  season: number;
  title: string;
  episodeCount: number;
  status: SeasonRequestStatus;
  episodes: RequestableEpisode[];
  counts?: {
    available?: number;
    requested?: number;
    upcoming?: number;
  };
}

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
