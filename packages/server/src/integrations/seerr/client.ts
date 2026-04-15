import { ofetch } from 'ofetch'
import type { DownloadProvider, AvailabilityStatus, RequestResult, RequestStatus } from '../types'

interface SerrClientConfig {
  baseUrl: string
  apiKey: string
}

/** Overseerr/Jellyseerr download provider. All methods are stubs pending implementation. */
export class SerrClient implements DownloadProvider {
  private readonly fetch: ReturnType<typeof ofetch.create>

  constructor(config: SerrClientConfig) {
    this.fetch = ofetch.create({
      baseURL: config.baseUrl,
      headers: {
        'X-Api-Key': config.apiKey,
      },
    })
  }

  async getAvailability(_tmdbId: string, _mediaType: 'movie' | 'tv'): Promise<AvailabilityStatus> {
    throw new Error('Not implemented')
  }

  async createRequest(
    _tmdbId: string,
    _mediaType: 'movie' | 'tv',
    _seasons?: string,
  ): Promise<RequestResult> {
    throw new Error('Not implemented')
  }

  async getRequests(): Promise<RequestStatus[]> {
    throw new Error('Not implemented')
  }
}
