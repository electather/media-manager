import type { CompactMediaItem } from "@ent-mcp/shared/home";

/**
 * Builds the shared `runtimeMin` + `releaseDate` facets from canonical
 * metadata. `releaseDate` doubles as the "upcoming?" flag on the client, so it
 * is only emitted when the release year is in the future — already-released
 * items must not land in the upcoming bucket.
 */
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
