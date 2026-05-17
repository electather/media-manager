import type { MediaType } from "@ent-mcp/shared/media";
import type { RawMediaItem } from "../preferences";
import { extractFeatures } from "./features";
import type { CanonicalMetadata, MetadataKey } from "./types";
import { dedupeStrings, nullableString } from "./util";

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
}

export type RawCanonicalSource = RawMediaItem & RawArtwork;

/**
 * Projects a raw plugin metadata payload onto a `CanonicalMetadata` row.
 * Used by both cold-fill (preference provider) and the metadata-refresh
 * job, so the persisted shape and timestamp policy stay in one place.
 *
 * `now` defaults to `Date.now()` so callers can pin time deterministically
 * in tests; the same value seeds `created_at`, `last_refreshed_at` and
 * `last_accessed_at` on a fresh insert. INSERT-OR-REPLACE keeps the
 * original `created_at` via a SQL `COALESCE` in `CatalogService.writeMetadata`.
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
