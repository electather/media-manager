import { ofetch } from 'ofetch'
import type { MetadataProvider, DiscoverFilters } from '../types'
import type { MediaItem, MediaDetails, SearchResult } from '../../media/types'

interface TmdbClientConfig {
  apiKey: string
  baseUrl?: string
}

/** TMDB metadata provider. All methods are stubs pending implementation. */
export class TmdbClient implements MetadataProvider {
  private readonly fetch: ReturnType<typeof ofetch.create>

  constructor(config: TmdbClientConfig) {
    this.fetch = ofetch.create({
      baseURL: config.baseUrl ?? 'https://api.themoviedb.org/3',
      query: { api_key: config.apiKey },
    })
  }

  async search(_query: string, _mediaType?: 'movie' | 'tv'): Promise<SearchResult[]> {
    throw new Error('Not implemented')
  }

  async getDetails(_id: string, _mediaType: 'movie' | 'tv'): Promise<MediaDetails> {
    throw new Error('Not implemented')
  }

  async getSimilar(_id: string, _mediaType: 'movie' | 'tv'): Promise<MediaItem[]> {
    throw new Error('Not implemented')
  }

  async getRecommendations(_id: string, _mediaType: 'movie' | 'tv'): Promise<MediaItem[]> {
    throw new Error('Not implemented')
  }

  async getTrending(_mediaType?: 'movie' | 'tv'): Promise<MediaItem[]> {
    throw new Error('Not implemented')
  }

  async discover(_filters: DiscoverFilters): Promise<MediaItem[]> {
    throw new Error('Not implemented')
  }
}
