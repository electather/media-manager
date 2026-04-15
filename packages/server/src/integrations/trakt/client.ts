import { ofetch } from 'ofetch'
import type { ActivityProvider } from '../types'
import type { MediaItem, WatchHistoryEntry, WatchlistEntry, ShowProgress, UpcomingEpisode } from '../../media/types'

interface TraktClientConfig {
  clientId: string
  accessToken?: string
  baseUrl?: string
}

/** Trakt activity provider. All methods are stubs pending implementation. */
export class TraktClient implements ActivityProvider {
  private readonly fetch: ReturnType<typeof ofetch.create>

  constructor(config: TraktClientConfig) {
    this.fetch = ofetch.create({
      baseURL: config.baseUrl ?? 'https://api.trakt.tv',
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': config.clientId,
        ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
      },
    })
  }

  async getWatchHistory(_limit?: number): Promise<WatchHistoryEntry[]> {
    throw new Error('Not implemented')
  }

  async getWatchlist(_mediaType?: 'movie' | 'tv'): Promise<WatchlistEntry[]> {
    throw new Error('Not implemented')
  }

  async getShowProgress(_traktId: number): Promise<ShowProgress> {
    throw new Error('Not implemented')
  }

  async getUpcoming(): Promise<UpcomingEpisode[]> {
    throw new Error('Not implemented')
  }

  async getRecommendations(_mediaType?: 'movie' | 'tv'): Promise<MediaItem[]> {
    throw new Error('Not implemented')
  }

  async syncRating(_tmdbId: string, _mediaType: 'movie' | 'tv', _rating: number): Promise<void> {
    throw new Error('Not implemented')
  }
}
