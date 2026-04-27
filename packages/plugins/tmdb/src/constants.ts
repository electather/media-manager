export const BASE = "https://api.themoviedb.org/3";
export const DEFAULT_POSTER_BASE = "https://image.tmdb.org/t/p/w500";
export const DEFAULT_REGION = "US";

export const DEFAULT_ARTWORK_SIZES = {
  poster: "w780",
  backdrop: "w1280",
  clearLogo: "w500",
} as const;

export type ArtworkSizeKind = keyof typeof DEFAULT_ARTWORK_SIZES;

/**
 * TMDB uses different sort and date keys for `/discover/movie` vs
 * `/discover/tv`. Movies sort on `primary_release_date`; TV sorts on
 * `first_air_date`. The capability's `sort` enum is endpoint-agnostic; these
 * maps project each variant onto the native key TMDB expects per endpoint.
 */
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
