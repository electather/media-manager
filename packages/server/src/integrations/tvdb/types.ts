/** Raw TVDB API response shapes. */

export interface TvdbSeries {
  id: number;
  name: string;
  year: string;
  overview: string | null;
  image: string | null;
  genres: Array<{ name: string }>;
  averageRating: number | null;
}

export interface TvdbEpisode {
  id: number;
  seriesId: number;
  name: string;
  aired: string | null;
  seasonNumber: number;
  number: number;
  overview: string | null;
}

export interface TvdbSearchResult {
  objectID: string;
  type: string;
  tvdb_id: string;
  name: string;
  year: string;
  overview: string | null;
  image_url: string | null;
}
