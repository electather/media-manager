import type { ArtworkErrorCode } from "./enums";
import type { MediaType } from "@ent-mcp/shared/media";

/**
 * One ranked artwork variant. Providers return up to five per kind sorted by
 * language preference then likes; consumers typically render index 0.
 *
 * `language` is a 2-8 char tag such as `"en"`, `"fr"`, or `"00"` (textless).
 */
export interface ArtworkVariant {
  url: string;
  language: string;
  likes?: number;
  width?: number;
  height?: number;
}

/**
 * Full per-item artwork response. Every kind is always present so consumers
 * can distinguish "asked, none found" (empty array, cacheable as a negative)
 * from "didn't ask".
 */
export interface ArtworkBundle {
  poster: ArtworkVariant[];
  backdrop: ArtworkVariant[];
  clearLogo: ArtworkVariant[];
  thumb: ArtworkVariant[];
}

/**
 * Cross-service ids for one media item. At least one of `tmdb`/`imdb`/`tvdb`
 * must be present; providers pick the id they can serve per their declared
 * `supportedIdTypes`.
 */
export interface ArtworkIdMap {
  tmdb?: string;
  imdb?: string;
  tvdb?: string;
}

/** One entry in an `artwork.get` batch request. */
export interface ArtworkRequestItem {
  /** Stable client-supplied key; opaque to the server, echoed in results. */
  key: string;
  ids: ArtworkIdMap;
  type: MediaType;
}

/** Per-item error returned by the `artwork.get` RPC. */
export interface ArtworkError {
  code: ArtworkErrorCode;
  message: string;
}

/** Full `artwork.get` response shape. */
export interface ArtworkGetResponse {
  results: Record<string, ArtworkBundle>;
  errors?: Record<string, ArtworkError>;
  generatedAt: number;
}
