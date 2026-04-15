import type { DownloadProvider, AvailabilityStatus, RequestResult, RequestStatus } from "../types";

export interface SerrClientConfig {
  baseUrl: string;
  apiKey: string;
}

/** Overseerr/Jellyseerr download provider. All methods are stubs pending implementation. */
export class SerrClient implements DownloadProvider {
  constructor(_config: SerrClientConfig) {}

  async getAvailability(_tmdbId: string, _mediaType: "movie" | "tv"): Promise<AvailabilityStatus> {
    throw new Error("Not implemented");
  }

  async createRequest(
    _tmdbId: string,
    _mediaType: "movie" | "tv",
    _seasons?: string,
  ): Promise<RequestResult> {
    throw new Error("Not implemented");
  }

  async getRequests(): Promise<RequestStatus[]> {
    throw new Error("Not implemented");
  }
}
