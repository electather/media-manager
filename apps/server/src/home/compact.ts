import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { CanonicalMetadata } from "../catalog/types";
import { toCompactFromRaw } from "../media/mappers";

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
 * Single conversion site for the wire-level `CompactMediaItem`. Delegates
 * to the shared `toCompactFromRaw` mapper (REQ-014) so server- and
 * client-side projections stay byte-identical.
 *
 * Absent values are *omitted*, never null/undefined; matches the same
 * compression discipline `ent_discover` uses on the MCP wire.
 */
export function toCompact(
  item: RawMediaItem,
  extras: Partial<CompactMediaItem> = {},
): CompactMediaItem {
  const tmdbId = item.ids?.tmdb_id ?? extractTmdbId(item.id);
  if (!tmdbId) {
    throw new Error(`media item ${item.id} missing tmdb id; cannot compact`);
  }
  const compact = toCompactFromRaw(item, composeId(item.type, tmdbId), extras);
  // Home wire keeps overviews short — detail wire (`media.get`) carries the
  // full string. Truncation lives here, not in the shared mapper, because
  // it is a wire-shape decision specific to row payloads.
  if (compact.overview) compact.overview = truncate(compact.overview, 240);
  return compact;
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
// fallow-ignore-next-line complexity
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
