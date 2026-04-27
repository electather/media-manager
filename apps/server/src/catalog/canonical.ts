import type { ArtworkBundle } from "@ent-mcp/shared/artwork";
import type { MediaType } from "@ent-mcp/shared/media";
import type { RawMediaItem } from "../preferences/provider";
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
  thumbUrl?: string | null;
  thumb?: string | null;
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
 *
 * Per V46, when `bundle` is supplied (from a parallel `artwork@v1` dispatch)
 * it overrides the per-kind artwork URLs taken from `raw`. The dispatcher
 * has already merged variants in `providerPriority` order so `[0]?.url` is
 * the top-priority variant. Absent kinds fall through to `null` rather than
 * back to `raw` — providers that emit a `posterUrl` alongside `artwork@v1`
 * coverage are expected to drop the duplicate once the bundle is the source
 * of truth. Bundle absent → fall back to the raw payload (cold-fill before
 * `artwork@v1` lands, or refresh job in degrade mode).
 */
export function toCanonicalRow(
  key: MetadataKey,
  raw: RawCanonicalSource,
  now: number = Date.now(),
  bundle: ArtworkBundle | null = null,
): CanonicalMetadata {
  return {
    tmdbId: key.tmdbId,
    mediaType: key.type,
    title: raw.title ?? `${key.type}:${key.tmdbId}`,
    year: raw.year ?? null,
    runtimeMinutes: raw.runtime ?? null,
    posterUrl: pickBundleOrRaw(bundle?.poster, raw.posterUrl, raw.poster),
    backdropUrl: pickBundleOrRaw(bundle?.backdrop, raw.backdropUrl, raw.backdrop),
    clearLogoUrl: pickBundleOrRaw(bundle?.clearLogo, raw.clearLogoUrl, raw.clearLogo),
    thumbUrl: pickBundleOrRaw(bundle?.thumb, raw.thumbUrl, raw.thumb),
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

/**
 * Per V46, when an `artwork@v1` bundle was fetched the top-priority variant
 * for the kind wins outright — even when the variant array is present but
 * empty (provider asked, found nothing). When the bundle was not fetched
 * at all (`undefined`), fall back to the raw payload's artwork fields.
 */
function pickBundleOrRaw(
  variants: ArtworkBundle[keyof ArtworkBundle] | undefined,
  ...rawCandidates: Array<string | null | undefined>
): string | null {
  if (variants !== undefined) return nullableString(variants[0]?.url);
  return pickArtwork(...rawCandidates);
}

function emptyToNull<T>(values: T[]): T[] | null {
  return values.length > 0 ? values : null;
}
