import type { PluginContext } from "@nama/plugin-sdk";
import {
  jsonRes,
  makeTestContext,
  paginatedPage as sdkPaginatedPage,
  statusRes,
  type TestContext,
} from "@nama/plugin-sdk/testing";

export { jsonRes, statusRes };

export function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: {
      credentials: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        createdAt: 0,
        expiresIn: 60 * 60 * 24 * 30,
      },
      sharedCredentials: { clientId: "cid", clientSecret: "csecret" },
      ...overrides,
    },
  });
}

// Trakt paged endpoints only need page-count for tests; shim the SDK's full signature.
export function paginatedPage(body: unknown, pageCount: number = 1): Response {
  return sdkPaginatedPage(body, 1, pageCount);
}

export const MOVIE = {
  ids: { trakt: 1, slug: "fight-club", imdb: "tt0137523", tmdb: 550 },
  title: "Fight Club",
  year: 1999,
};

export const SHOW = {
  ids: { trakt: 2, slug: "got", imdb: "tt0944947", tmdb: 1399, tvdb: 121361 },
  title: "Game of Thrones",
  year: 2011,
};
