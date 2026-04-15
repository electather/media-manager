/** Raw TMDB API response shapes. */

export interface TmdbMovie {
  id: number
  title: string
  release_date: string
  overview: string
  poster_path: string | null
  genre_ids: number[]
  vote_average: number
}

export interface TmdbTv {
  id: number
  name: string
  first_air_date: string
  overview: string
  poster_path: string | null
  genre_ids: number[]
  vote_average: number
}

export interface TmdbMovieDetails extends TmdbMovie {
  runtime: number | null
  genres: Array<{ id: number; name: string }>
  videos: { results: Array<{ type: string; key: string }> }
  credits: {
    cast: Array<{ name: string; order: number }>
    crew: Array<{ name: string; job: string }>
  }
  keywords: { keywords: Array<{ name: string }> }
}

export interface TmdbTvDetails extends TmdbTv {
  episode_run_time: number[]
  genres: Array<{ id: number; name: string }>
  videos: { results: Array<{ type: string; key: string }> }
  credits: {
    cast: Array<{ name: string; order: number }>
    crew: Array<{ name: string; job: string }>
  }
  keywords: { results: Array<{ name: string }> }
  created_by: Array<{ name: string }>
}

export interface TmdbSearchResponse<T> {
  results: T[]
  total_results: number
  page: number
}
