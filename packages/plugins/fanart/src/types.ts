import type { PluginContext } from "@nama/plugin-sdk";

export interface FanartSharedCreds {
  apiKey: string;
}

export interface FanartUserCreds {}
export interface FanartUserCfg {}

export interface FanartGlobalCfg {
  assetCdnPrefix?: string;
}

export type Ctx = PluginContext<FanartUserCreds, FanartSharedCreds, FanartUserCfg, FanartGlobalCfg>;

/**
 * One artwork entry as fanart.tv returns it in any of the per-kind arrays
 * (`movieposter`, `moviebackground`, `hdmovielogo`, `moviethumb`, and their
 * tv equivalents). Only the fields the mapper consumes are typed; fanart
 * adds others (`id`, `season`, `disc`, …) that the artwork@v1 bundle has no
 * slot for and the mapper drops on the floor.
 */
export interface FanartImage {
  url: string;
  lang?: string;
  likes?: string;
}

/**
 * Shape of `GET /v3/movies/{id}` and `GET /v3/tv/{id}` responses. Every
 * per-kind array is optional — fanart omits the field entirely for items
 * with no art of that kind. The mapper treats absent as empty.
 */
export interface FanartResponse {
  movieposter?: FanartImage[];
  moviebackground?: FanartImage[];
  hdmovielogo?: FanartImage[];
  moviethumb?: FanartImage[];
  tvposter?: FanartImage[];
  showbackground?: FanartImage[];
  hdtvlogo?: FanartImage[];
  tvthumb?: FanartImage[];
}
