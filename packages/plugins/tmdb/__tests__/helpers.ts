import type { PluginContext } from "@nama/plugin-sdk";
import { jsonRes, makeTestContext, type TestContext } from "@nama/plugin-sdk/testing";

export { jsonRes };

export function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): TestContext {
  return makeTestContext({
    responses,
    overrides: { sharedCredentials: { apiKey: "tmdb-key" }, ...overrides },
  });
}

export const MOVIE_RAW = {
  id: 550,
  title: "Fight Club",
  release_date: "1999-10-15",
  genres: [{ id: 18, name: "Drama" }],
  runtime: 139,
  original_language: "en",
  vote_average: 8.4,
  overview: "An insomniac office worker...",
  poster_path: "/poster.jpg",
  external_ids: { imdb_id: "tt0137523", tvdb_id: 666 },
  credits: {
    cast: [{ name: "Brad Pitt", order: 0 }],
    crew: [
      { name: "David Fincher", job: "Director", department: "Directing" },
      { name: "Jim Uhls", job: "Screenplay", department: "Writing" },
    ],
  },
  keywords: { keywords: [{ name: "soap" }] },
};

export const SHOW_RAW = {
  id: 1399,
  name: "Game of Thrones",
  first_air_date: "2011-04-17",
  genres: [{ id: 10765, name: "Sci-Fi & Fantasy" }],
  episode_run_time: [60],
  original_language: "en",
  vote_average: 8.4,
  overview: "Seven noble families...",
  poster_path: "/got.jpg",
  external_ids: { imdb_id: "tt0944947", tvdb_id: 121361 },
  credits: { cast: [], crew: [] },
  keywords: { results: [] },
  created_by: [{ name: "David Benioff" }],
};
