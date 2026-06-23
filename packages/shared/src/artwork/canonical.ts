import type { MediaType } from "../media/enums";
import type { ArtworkIdMap } from "./types";

/**
 * ID precedence: tmdb wins (canonical key column, only ID write-back can patch).
 * imdb/tvdb are fallbacks for items without tmdb ID.
 */
const CANONICAL_ID_PRECEDENCE = ["tmdb", "imdb", "tvdb"] as const;

/**
 * Stable canonical key from highest-precedence ID present (not whole subset).
 * E.g., `{tmdb:"550"}` and `{tmdb:"550", imdb:"tt1"}` both yield `movie|tmdb:550`.
 * Throws if no recognized ID (prevents unrelated empty-id items from collapsing).
 * Single source of truth for service dedupe and rate-limiter token charges — callers must validate with `artworkIdMapSchema` first.
 */
export function canonicalArtworkKey(ids: ArtworkIdMap, type: MediaType): string {
  for (const idType of CANONICAL_ID_PRECEDENCE) {
    const value = ids[idType];
    if (value) return `${type}|${idType}:${value}`;
  }
  throw new Error(
    `canonicalArtworkKey: id map for type "${type}" carries no recognised id (tmdb/imdb/tvdb)`,
  );
}

/** Number of unique canonical lookups in a batch (minimum 1). */
export function countCanonicalArtwork(
  items: readonly { ids: ArtworkIdMap; type: MediaType }[],
): number {
  const seen = new Set<string>();
  for (const item of items) seen.add(canonicalArtworkKey(item.ids, item.type));
  return Math.max(1, seen.size);
}
