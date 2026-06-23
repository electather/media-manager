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
 * One artwork entry from fanart.tv per-kind arrays.
 * Only fields the mapper consumes are typed; extras (`id`, `season`, `disc`, …) dropped.
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
