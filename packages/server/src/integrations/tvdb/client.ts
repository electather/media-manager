import { ofetch } from 'ofetch'

interface TvdbClientConfig {
  apiKey: string
  baseUrl?: string
}

/**
 * TVDB client for supplemental TV metadata.
 * Not bound to a provider interface yet — used directly by MediaService for ID mapping.
 */
export class TvdbClient {
  private readonly fetch: ReturnType<typeof ofetch.create>

  constructor(config: TvdbClientConfig) {
    this.fetch = ofetch.create({
      baseURL: config.baseUrl ?? 'https://api4.thetvdb.com/v4',
    })
    void config.apiKey // TODO: implement token-based auth flow
  }

  /** Returns the TVDB series ID for a given TMDB ID. */
  async getTvdbIdFromTmdb(_tmdbId: string): Promise<number | null> {
    throw new Error('Not implemented')
  }
}
