import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { CanonicalMetadata } from "../catalog/types";

const VALID_STATUSES: ReadonlySet<NonNullable<CompactMediaItem["status"]>> = new Set([
  "available",
  "requested",
  "processing",
  "unavailable",
  "unknown",
]);

/**
 * Narrows an arbitrary string (typically the value pulled from
 * `getStatusBatch`) to the wire-allowed status alphabet, returning
 * `undefined` for anything outside it. Lets row fetchers do
 * `compact.status = toStatusOrUndefined(map[id])` instead of repeating the
 * same five-way OR. Tested via row-fetcher contracts; the allowlist matches
 * the `CompactMediaItem.status` union.
 */
export function toStatusOrUndefined(value: string | undefined): CompactMediaItem["status"] {
  if (typeof value !== "string") return undefined;
  return VALID_STATUSES.has(value as NonNullable<CompactMediaItem["status"]>)
    ? (value as CompactMediaItem["status"])
    : undefined;
}

/**
 * Plugin-side `MediaItem` shape from `@ent-mcp/plugin-sdk`'s metadata
 * capability schema. Kept as a structural alias rather than a re-export so
 * the home feed depends on shape rather than importing through the SDK
 * boundary.
 */
export interface RawMediaItem {
  id: string;
  title: string;
  year?: number | null;
  type: "movie" | "tv";
  genres?: string[];
  rating?: number | null;
  overview?: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  clearLogoUrl?: string | null;
  ids?: { tmdb_id?: string; imdb_id?: string };
  userRating?: number | null;
}

/**
 * Single conversion site for the wire-level `CompactMediaItem`. Lives in one
 * file so adjustments to the home-feed wire shape (e.g. swapping a TMDB
 * fallback in for a fanart.tv asset) only touch one mapping.
 *
 * Absent values are *omitted*, never null/undefined; matches the same
 * compression discipline `ent_discover` uses on the MCP wire.
 */
// fallow-ignore-next-line complexity
export function toCompact(
  item: RawMediaItem,
  extras: Partial<CompactMediaItem> = {},
): CompactMediaItem {
  const tmdbId = item.ids?.tmdb_id ?? extractTmdbId(item.id);
  if (!tmdbId) {
    throw new Error(`media item ${item.id} missing tmdb id; cannot compact`);
  }
  const out: CompactMediaItem = {
    id: composeId(item.type, tmdbId),
    tmdbId,
    mediaType: item.type,
    title: item.title,
  };
  if (typeof item.year === "number" && Number.isFinite(item.year)) out.year = item.year;
  if (item.posterUrl) out.poster = item.posterUrl;
  if (item.backdropUrl) out.backdrop = item.backdropUrl;
  if (item.clearLogoUrl) out.clearLogo = item.clearLogoUrl;
  if (item.overview) out.overview = truncate(item.overview, 240);
  if (item.genres && item.genres.length > 0) out.genres = item.genres.slice(0, 3);
  if (typeof item.rating === "number") out.rating = item.rating;
  if (typeof item.userRating === "number") out.userRating = item.userRating;
  return Object.assign(out, stripUndefined(extras));
}

/** Builds a `RawMediaItem` from a canonical metadata row for row fetchers. */
// fallow-ignore-next-line complexity
export function canonicalToRaw(row: CanonicalMetadata): RawMediaItem {
  return {
    id: `${row.mediaType}:${row.tmdbId}`,
    type: row.mediaType,
    title: row.title,
    year: row.year ?? undefined,
    genres: row.genres ?? [],
    overview: row.overview ?? undefined,
    posterUrl: row.posterUrl ?? undefined,
    backdropUrl: row.backdropUrl ?? undefined,
    clearLogoUrl: row.clearLogoUrl ?? undefined,
    ids: { tmdb_id: row.tmdbId },
  };
}

/** Composes `"movie:550"` / `"tv:1396"` from `(type, tmdbId)`. */
export function composeId(type: "movie" | "tv", tmdbId: string): string {
  return `${type}:${tmdbId}`;
}

/** Splits `"movie:550"` into `["movie", "550"]`; returns null on malformed input. */
export function parseCompactId(id: string): { mediaType: "movie" | "tv"; tmdbId: string } | null {
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const head = id.slice(0, idx);
  const tail = id.slice(idx + 1);
  if (head !== "movie" && head !== "tv") return null;
  if (tail.length === 0) return null;
  return { mediaType: head, tmdbId: tail };
}

function extractTmdbId(id: string): string | null {
  const parsed = parseCompactId(id);
  return parsed?.tmdbId ?? null;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).trimEnd() + "…";
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(value) as Array<[keyof T, T[keyof T]]>) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
