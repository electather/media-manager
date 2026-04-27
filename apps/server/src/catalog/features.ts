import type { CandidateFeatures } from "../preferences/types";
import type { RawMediaItem } from "../preferences/provider";
import type { CanonicalMetadata, CanonicalFeatures, MetadataKey } from "./types";
import { dedupeStrings, nullableString } from "./util";

/**
 * Single source for projecting a plugin metadata payload onto the catalog
 * scoring blob. Cold-fill (preference provider) and the metadata-refresh
 * job both call this so the persisted shape stays in sync.
 */
export function extractFeatures(item: RawMediaItem): CanonicalFeatures {
  return {
    keywords: dedupeStrings(item.keywords),
    cast: dedupeStrings(item.cast),
    director: nullableString(item.director),
    writers: dedupeStrings(item.writers),
    creators: dedupeStrings(item.creators),
  };
}

/**
 * Reconstitutes the PE-side `CandidateFeatures` shape from a stored catalog
 * row. Display fields (title/year/runtime/genres/language) come off the row
 * columns; scoring-only fields come off the features blob.
 */
export function toCandidateFeatures(row: CanonicalMetadata): CandidateFeatures {
  const features = row.features;
  return {
    id: candidateId({ tmdbId: row.tmdbId, type: row.mediaType }),
    type: row.mediaType,
    title: row.title,
    year: row.year ?? null,
    runtime: row.runtimeMinutes ?? null,
    genres: row.genres ?? [],
    keywords: features?.keywords ?? [],
    cast: features?.cast ?? [],
    director: features?.director ?? null,
    writers: features?.writers ?? [],
    creators: features?.creators ?? [],
    originalLanguage: row.originalLanguage ?? null,
  };
}

export function candidateId(key: MetadataKey): string {
  return `${key.type}:${key.tmdbId}`;
}
