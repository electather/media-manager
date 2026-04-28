import type { PluginContext } from "@ent-mcp/plugin-sdk";

export interface TmdbSharedCreds {
  apiKey?: string;
}

export interface TmdbUserCreds {
  apiKey?: string;
}

export interface TmdbUserCfg {}

// Config keys mirror the artwork@v1 bundle field names so admins reading
// config alongside a response see the same vocabulary in both places.
export interface TmdbGlobalCfg {
  imageBaseUrl?: string;
  artworkSizes?: {
    poster?: string;
    backdrop?: string;
    clearLogo?: string;
  };
}

export type Ctx = PluginContext<TmdbUserCreds, TmdbSharedCreds, TmdbUserCfg, TmdbGlobalCfg>;

export interface Genre {
  id: number;
  name: string;
}

export interface CastMember {
  name: string;
  order: number;
}

export interface CrewMember {
  name: string;
  job: string;
  department: string;
}

export interface Credits {
  cast?: CastMember[];
  crew?: CrewMember[];
}

export interface Keyword {
  name: string;
}

export interface MovieRaw {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  genre_ids?: number[];
  genres?: Genre[];
  runtime?: number | null;
  original_language?: string | null;
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  imdb_id?: string | null;
  credits?: Credits;
  keywords?: { keywords?: Keyword[] };
}

export interface TvRaw {
  id: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: Genre[];
  episode_run_time?: number[];
  original_language?: string | null;
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  created_by?: Array<{ name: string }>;
  credits?: Credits;
  keywords?: { results?: Keyword[] };
}

export interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  vote_average: number | null;
  width?: number | null;
  height?: number | null;
}

export interface DiscoverFilters {
  genres?: string[];
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  gteIso?: string;
  lteIso?: string;
  sort?: "popularity_desc" | "popularity_asc" | "release_date_desc" | "release_date_asc";
}
