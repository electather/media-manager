import type { MediaType } from "../media/enums";
import type { ArtworkIdMap } from "./types";

/**
 * Id precedence used to derive a single stable canonical key for a title.
 * `tmdb` wins because it is the column the canonical metadata row is keyed on
 * and the only id the write-back can patch; `imdb`/`tvdb` are fallbacks for
 * items that omit a tmdb id.
 */
const CANONICAL_ID_PRECEDENCE = ["tmdb", "imdb", "tvdb"] as const;

/**
 * Stable canonical key for an artwork lookup. Keys on the single
 * highest-precedence id present (not the whole id subset) so two items that
 * point at the same logical title collapse to one key regardless of which id
 * subset the client happened to send — e.g. `{tmdb:"550"}` and
 * `{tmdb:"550", imdb:"tt1"}` both yield `movie|tmdb:550`. The id map is
 * guaranteed non-empty by `artworkIdMapSchema`, but we fall back to a
 * type-only key defensively so the function is total.
 *
 * Single source of truth: both the service dedupe and the rate-limiter's
 * per-canonical token charge call this, so a request can never be charged a
 * different number of tokens than the number of dispatches it performs.
 */
export function canonicalArtworkKey(ids: ArtworkIdMap, type: MediaType): string {
  for (const idType of CANONICAL_ID_PRECEDENCE) {
    const value = ids[idType];
    if (value) return `${type}|${idType}:${value}`;
  }
  // Unreachable for validated input — `artworkIdMapSchema.refine` rejects an
  // empty id map. The type-only fallback keeps this total; it is intentional
  // dead code, not a collapse path two real titles can hit.
  return type;
}

/** Number of unique canonical lookups in a batch (minimum 1). */
export function countCanonicalArtwork(
  items: readonly { ids: ArtworkIdMap; type: MediaType }[],
): number {
  const seen = new Set<string>();
  for (const item of items) seen.add(canonicalArtworkKey(item.ids, item.type));
  return Math.max(1, seen.size);
}
