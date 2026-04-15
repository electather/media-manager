export interface TvdbClientConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * TVDB client for supplemental TV metadata.
 * Not bound to a provider interface yet — used directly by MediaService for ID mapping.
 */
export class TvdbClient {
  constructor(_config: TvdbClientConfig) {}

  /** Returns the TVDB series ID for a given TMDB ID. */
  async getTvdbIdFromTmdb(_tmdbId: string): Promise<number | null> {
    throw new Error("Not implemented");
  }
}
