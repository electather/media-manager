import type { CompactMediaItem } from "@nama/shared/home";

// Builds runtimeMin + releaseDate facets. releaseDate doubles as "upcoming?" flag
// on client, only emitted when release year is in future (no already-released items).
export function buildFacets(meta: {
  runtimeMinutes?: number | null;
  year?: number | null;
}): NonNullable<CompactMediaItem["facets"]> {
  const facets: NonNullable<CompactMediaItem["facets"]> = {};
  if (meta.runtimeMinutes != null) facets.runtimeMin = meta.runtimeMinutes;
  if (meta.year != null && meta.year > new Date().getUTCFullYear()) {
    facets.releaseDate = String(meta.year);
  }
  return facets;
}
