import type { TmdbMovie, TmdbTv, TmdbMovieDetails, TmdbTvDetails } from './types'
import type { MediaItem, MediaDetails, SearchResult } from '../../media/types'

// TODO: implement - map TMDB movie to internal MediaItem.
export function mapTmdbMovie(_raw: TmdbMovie): MediaItem {
  throw new Error('Not implemented')
}

// TODO: implement - map TMDB TV show to internal MediaItem.
export function mapTmdbTv(_raw: TmdbTv): MediaItem {
  throw new Error('Not implemented')
}

// TODO: implement - map TMDB movie details to internal MediaDetails.
export function mapTmdbMovieDetails(_raw: TmdbMovieDetails): MediaDetails {
  throw new Error('Not implemented')
}

// TODO: implement - map TMDB TV details to internal MediaDetails.
export function mapTmdbTvDetails(_raw: TmdbTvDetails): MediaDetails {
  throw new Error('Not implemented')
}

// TODO: implement - wrap a MediaItem as a SearchResult with a score.
export function toSearchResult(_item: MediaItem, _score: number): SearchResult {
  throw new Error('Not implemented')
}
