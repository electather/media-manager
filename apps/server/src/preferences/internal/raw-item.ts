import type { CandidateFeatures, RawMediaItem } from "../types";

/**
 * Normalizes an arbitrary plugin-shaped media item into the `CandidateFeatures`
 * projection. Plugins disagree on field naming, so the adapter stays defensive.
 */
// fallow-ignore-next-line complexity
export function rawItemToCandidateFeatures(source: RawMediaItem): CandidateFeatures | null {
  const tmdbId = source.ids?.tmdb_id ?? extractIdFromCombined(source.id);
  const type = source.type ?? inferTypeFromCombined(source.id);
  if (!tmdbId || !type) return null;
  return {
    id: `${type}:${tmdbId}`,
    type,
    title: source.title,
    year: source.year ?? null,
    runtime: source.runtime ?? null,
    genres: source.genres ?? [],
    keywords: source.keywords ?? [],
    cast: source.cast ?? [],
    director: source.director ?? null,
    writers: source.writers ?? [],
    creators: source.creators ?? [],
    originalLanguage: source.originalLanguage ?? null,
  };
}

function extractIdFromCombined(combined: string | undefined): string | undefined {
  if (!combined) return undefined;
  const [, id] = combined.split(":");
  return id;
}

function inferTypeFromCombined(combined: string | undefined): "movie" | "tv" | undefined {
  if (!combined) return undefined;
  const [type] = combined.split(":");
  return type === "movie" || type === "tv" ? type : undefined;
}
