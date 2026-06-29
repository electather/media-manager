export const BASE = "https://api.themoviedb.org/3";
export const DEFAULT_POSTER_BASE = "https://image.tmdb.org/t/p/w500";
export const DEFAULT_REGION = "US";

/**
 * Bundled TMDB v3 key — public by design (self-hosted, mirrors seerr). Lowest-
 * priority fallback; any admin pool entry or user key overrides it. RELEASE
 * BLOCKER: ships as the placeholder sentinel until a nama-owned free TMDB v3 key
 * is registered. The `REPLACE_WITH_` prefix gates synthesis off (design §2/§6) —
 * tmdbConfigured stays false so onboarding stays required, no blank-poster trap.
 * Do NOT reuse jellyseerr's key.
 */
export const TMDB_BUNDLED_KEY = "REPLACE_WITH_NAMA_TMDB_V3_KEY";

export const DEFAULT_ARTWORK_SIZES = {
  poster: "w780",
  backdrop: "w1280",
  clearLogo: "w500",
} as const;

export type ArtworkSizeKind = keyof typeof DEFAULT_ARTWORK_SIZES;

/** TMDB `/discover/movie` uses `primary_release_date`, `/discover/tv` uses `first_air_date`. Maps project endpoint-agnostic `sort` enum to native TMDB keys. */
export const SORT_MAP_MOVIE: Record<string, string> = {
  popularity_desc: "popularity.desc",
  popularity_asc: "popularity.asc",
  release_date_desc: "primary_release_date.desc",
  release_date_asc: "primary_release_date.asc",
};

export const SORT_MAP_TV: Record<string, string> = {
  popularity_desc: "popularity.desc",
  popularity_asc: "popularity.asc",
  release_date_desc: "first_air_date.desc",
  release_date_asc: "first_air_date.asc",
};
