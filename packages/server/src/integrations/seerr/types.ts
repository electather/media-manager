/** Raw Overseerr/Jellyseerr API response shapes. */

export interface SerrMediaInfo {
  id: number;
  tmdbId: number;
  mediaType: "movie" | "tv";
  status: number;
  downloadStatus: unknown[];
}

export interface SerrRequest {
  id: number;
  status: number;
  media: SerrMediaInfo;
  requestedBy: { id: number; displayName: string };
  createdAt: string;
}

export interface SerrRequestBody {
  mediaType: "movie" | "tv";
  mediaId: number;
  seasons?: number[];
}
