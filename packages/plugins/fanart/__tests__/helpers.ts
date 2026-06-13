import type { PluginContext } from "@nama/plugin-sdk";
import { jsonRes, makeTestContext, type TestContext } from "@nama/plugin-sdk/testing";

export { jsonRes };

export function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: { sharedCredentials: { apiKey: "fanart-key" }, ...overrides },
  });
}

/**
 * Minimal fanart movie response used across the contract suite. Real fanart
 * payloads carry many more fields (id, season, disc, …) which the mapper is
 * expected to drop on the floor; the fixture keeps only what the mapper
 * consumes so unintended dependencies on other fields surface in tests.
 */
export const MOVIE_RICH = {
  movieposter: [
    {
      url: "https://assets.fanart.tv/fanart/movies/550/movieposter/en.jpg",
      lang: "en",
      likes: "5",
    },
    {
      url: "https://assets.fanart.tv/fanart/movies/550/movieposter/textless.jpg",
      lang: "00",
      likes: "9",
    },
    {
      url: "https://assets.fanart.tv/fanart/movies/550/movieposter/fr.jpg",
      lang: "fr",
      likes: "3",
    },
  ],
  moviebackground: [
    {
      url: "https://assets.fanart.tv/fanart/movies/550/moviebackground/bg.jpg",
      lang: "00",
      likes: "7",
    },
  ],
  hdmovielogo: [
    {
      url: "https://assets.fanart.tv/fanart/movies/550/hdmovielogo/en-logo.png",
      lang: "en",
      likes: "4",
    },
  ],
  moviethumb: [
    {
      url: "https://assets.fanart.tv/fanart/movies/550/moviethumb/thumb.jpg",
      lang: "en",
      likes: "2",
    },
  ],
};

export const TV_RICH = {
  tvposter: [
    { url: "https://assets.fanart.tv/fanart/tv/12345/tvposter/en.jpg", lang: "en", likes: "8" },
  ],
  showbackground: [
    {
      url: "https://assets.fanart.tv/fanart/tv/12345/showbackground/bg.jpg",
      lang: "00",
      likes: "6",
    },
  ],
  hdtvlogo: [
    { url: "https://assets.fanart.tv/fanart/tv/12345/hdtvlogo/en.png", lang: "en", likes: "5" },
  ],
  tvthumb: [
    { url: "https://assets.fanart.tv/fanart/tv/12345/tvthumb/thumb.jpg", lang: "en", likes: "3" },
  ],
};
