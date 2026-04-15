/** Raw Trakt API response shapes. */

export interface TraktHistoryEntry {
  id: number
  watched_at: string
  action: string
  type: 'movie' | 'episode'
  movie?: TraktMovie
  episode?: TraktEpisode
  show?: TraktShow
}

export interface TraktWatchlistEntry {
  id: number
  listed_at: string
  type: 'movie' | 'show'
  movie?: TraktMovie
  show?: TraktShow
}

export interface TraktMovie {
  title: string
  year: number
  ids: { trakt: number; slug: string; imdb: string; tmdb: number }
}

export interface TraktShow {
  title: string
  year: number
  ids: { trakt: number; slug: string; imdb: string; tmdb: number; tvdb: number }
}

export interface TraktEpisode {
  season: number
  number: number
  title: string
  ids: { trakt: number; tvdb: number; imdb: string; tmdb: number }
}

export interface TraktShowProgress {
  aired: number
  completed: number
  seasons: Array<{
    number: number
    aired: number
    completed: number
    episodes: Array<{ number: number; completed: boolean }>
  }>
  next_episode: TraktEpisode | null
}
