import type { TraktHistoryEntry, TraktWatchlistEntry, TraktShowProgress } from './types'
import type { WatchHistoryEntry, WatchlistEntry, ShowProgress } from '../../media/types'

// TODO: implement - map Trakt history entry to internal WatchHistoryEntry.
export function mapTraktHistory(_raw: TraktHistoryEntry): WatchHistoryEntry {
  throw new Error('Not implemented')
}

// TODO: implement - map Trakt watchlist entry to internal WatchlistEntry.
export function mapTraktWatchlist(_raw: TraktWatchlistEntry): WatchlistEntry {
  throw new Error('Not implemented')
}

// TODO: implement - map Trakt show progress to internal ShowProgress.
export function mapTraktProgress(_showId: string, _raw: TraktShowProgress): ShowProgress {
  throw new Error('Not implemented')
}
