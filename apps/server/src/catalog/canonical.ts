import type { MediaType } from "@nama/shared/media";
import type { CanonicalMetadata, MetadataKey } from "@nama/shared/catalog";
import type { RawMediaItem } from "../preferences";
import { extractFeatures } from "./features";
import { dedupeStrings, nullableString } from "./internal/strings";

/**
 * Optional artwork fields lifted off whatever shape the plugin returned.
 * Plugins disagree on naming, so we accept the union and pick the first
 * non-empty value. Per V44 these become the canonical URLs once written.
 */
export interface RawArtwork {
  posterUrl?: string | null;
  poster?: string | null;
  backdropUrl?: string | null;
  backdrop?: string | null;
  clearLogoUrl?: string | null;
  clearLogo?: string | null;
  overview?: string | null;
  // TMDB franchise grouping threaded from the plugin `mediaItem.collection`.
  // Optional and nullable so non-movie and pre-threading payloads still map.
  collection?: { id: string; name: string } | null;
}

export type RawCanonicalSource = RawMediaItem & RawArtwork;

/**
 * Projects raw plugin metadata onto `CanonicalMetadata` row. Used by cold-fill
 * and metadata-refresh job so shape/timestamp policy stay in one place.
 * `now` defaults to `Date.now()` for deterministic tests; seeds `created_at`,
 * `last_refreshed_at`, `last_accessed_at`. INSERT-OR-REPLACE via SQL `COALESCE`
 * preserves the original `created_at`.
 */
export function toCanonicalRow(
  key: MetadataKey,
  raw: RawCanonicalSource,
  now: number = Date.now(),
): CanonicalMetadata {
  return {
    tmdbId: key.tmdbId,
    mediaType: key.type,
    title: raw.title ?? `${key.type}:${key.tmdbId}`,
    year: raw.year ?? null,
    runtimeMinutes: raw.runtime ?? null,
    posterUrl: pickArtwork(raw.posterUrl, raw.poster),
    backdropUrl: pickArtwork(raw.backdropUrl, raw.backdrop),
    clearLogoUrl: pickArtwork(raw.clearLogoUrl, raw.clearLogo),
    overview: nullableString(raw.overview),
    originalLanguage: nullableString(raw.originalLanguage),
    genres: emptyToNull(dedupeStrings(raw.genres)),
    collectionId: raw.collection?.id ?? null,
    collectionName: raw.collection?.name ?? null,
    features: extractFeatures(raw),
    lastRefreshedAt: now,
    lastAccessedAt: now,
    createdAt: now,
  };
}

export function asMetadataKey(tmdbId: string, type: MediaType): MetadataKey {
  return { tmdbId, type };
}

function pickArtwork(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const value = nullableString(c);
    if (value) return value;
  }
  return null;
}

function emptyToNull<T>(values: T[]): T[] | null {
  return values.length > 0 ? values : null;
}
