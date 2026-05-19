import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { take } from "es-toolkit/array";

/**
 * Subset of the plugin-SDK `mediaItem` the menu actually consumes. The
 * dispatcher loses the strong type at the boundary, so we narrow to a
 * permissive shape here and validate field-by-field below.
 */
export interface PluginMediaRaw {
  id?: string;
  title?: string;
  type?: "movie" | "tv";
  year?: number | null;
  posterUrl?: string | null;
  overview?: string;
  genres?: string[];
  rating?: number | null;
  runtime?: number | null;
  ids?: { tmdb_id?: string };
}

function buildFacets(raw: PluginMediaRaw): CompactMediaItem["facets"] {
  const facets: NonNullable<CompactMediaItem["facets"]> = {};
  if (raw.runtime != null) facets.runtimeMin = raw.runtime;
  if (raw.year != null) facets.releaseDate = String(raw.year);
  return Object.keys(facets).length > 0 ? facets : undefined;
}

// fallow-ignore-next-line complexity
function applyOptionalFields(item: CompactMediaItem, raw: PluginMediaRaw): void {
  if (raw.year != null) item.year = raw.year;
  if (raw.posterUrl) item.poster = raw.posterUrl;
  if (raw.overview) item.overview = raw.overview;
  // Cap at three genres to match the home-row chip strip — keeps the menu row
  // visually balanced and the wire payload small.
  if (raw.genres && raw.genres.length > 0) item.genres = take(raw.genres, 3);
  if (raw.rating != null) item.rating = raw.rating;
  const facets = buildFacets(raw);
  if (facets) item.facets = facets;
}

/**
 * Maps a raw plugin media item (from `metadata@v1.search` or `getTrending`)
 * to the wire `CompactMediaItem` shape. Returns `null` when required fields
 * are missing — callers should drop nulls before responding.
 */
// fallow-ignore-next-line complexity
export function compactFromRaw(raw: PluginMediaRaw | null | undefined): CompactMediaItem | null {
  if (!raw) return null;
  const tmdbId = raw.ids?.tmdb_id ?? raw.id;
  const mediaType = raw.type;
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv") || !raw.title) {
    return null;
  }
  const item: CompactMediaItem = {
    id: `${mediaType}:${tmdbId}`,
    tmdbId,
    mediaType,
    title: raw.title,
  };
  applyOptionalFields(item, raw);
  return item;
}
