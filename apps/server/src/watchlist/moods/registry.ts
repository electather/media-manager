import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { MoodId } from "@nama/shared/watchlist";
import { MOOD_IDS } from "@nama/shared/watchlist";

/** Re-export so server-internal callers don't reach into the shared barrel. */
export { MOOD_IDS };
export type { MoodId };

/**
 * Server-only mood predicates over `(CanonicalMetadata)`. Heuristic — genre
 * matching is locale-bound (English TMDB labels), runtime + year are
 * numeric. See design `docs/2026-05-23-watchlist-sections-design.md` §S.3.
 */
export interface MoodInputs {
  meta: CanonicalMetadata | undefined;
}

type Predicate = (inputs: MoodInputs) => boolean;

function hasGenre(meta: CanonicalMetadata | undefined, names: readonly string[]): boolean {
  if (!meta?.genres) return false;
  const lower = meta.genres.map((g) => g.toLowerCase());
  return names.some((n) => lower.includes(n));
}

const COZY_GENRES = ["family", "romance", "comedy"] as const;
const EPIC_GENRES = ["adventure", "fantasy", "war"] as const;
const CEREBRAL_GENRES = ["documentary", "mystery"] as const;
const DARK_GENRES = ["horror", "thriller", "crime"] as const;
const LAUGH_GENRES = ["comedy", "animation"] as const;

export const MOOD_RULES: Record<MoodId, Predicate> = {
  // fallow-ignore-next-line complexity
  cozy: ({ meta }) =>
    hasGenre(meta, COZY_GENRES) &&
    (meta?.runtimeMinutes ?? Number.POSITIVE_INFINITY) < 100 &&
    (meta?.year ?? 0) >= 1990,
  epic: ({ meta }) => hasGenre(meta, EPIC_GENRES) || (meta?.runtimeMinutes ?? 0) >= 150,
  // fallow-ignore-next-line complexity
  cerebral: ({ meta }) =>
    hasGenre(meta, CEREBRAL_GENRES) || (hasGenre(meta, ["drama"]) && (meta?.year ?? 0) < 2000),
  dark: ({ meta }) => hasGenre(meta, DARK_GENRES),
  laugh: ({ meta }) => hasGenre(meta, LAUGH_GENRES),
  throwback: ({ meta }) => (meta?.year ?? Number.POSITIVE_INFINITY) < 1990,
  quick: ({ meta }) =>
    meta?.mediaType === "movie" && (meta.runtimeMinutes ?? Number.POSITIVE_INFINITY) <= 95,
  // `episodeCount` is not in `CanonicalMetadata`; binge collapses to "any TV
  // show". Promote to true episode-count threshold when metadata exposes it.
  binge: ({ meta }) => meta?.mediaType === "tv",
};
