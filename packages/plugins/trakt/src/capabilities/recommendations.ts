import { traktJson } from "../client";
import { mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow } from "../types";

export const recommendations = {
  async getRecommendations(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type = "movie", limit = 20 } = input as { type?: "movie" | "tv"; limit?: number };
    const path = type === "movie" ? "/recommendations/movies" : "/recommendations/shows";
    const data = await traktJson<Array<TraktMovie | TraktShow>>(c, `${path}?limit=${limit}`);
    return data.map((row) =>
      type === "movie" ? mapMovie(row as TraktMovie) : mapShow(row as TraktShow),
    );
  },

  async getTrending(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type = "movie", limit = 20 } = input as { type?: "movie" | "tv"; limit?: number };
    const path = type === "movie" ? "/movies/trending" : "/shows/trending";
    const data = await traktJson<Array<{ watchers: number; movie?: TraktMovie; show?: TraktShow }>>(
      c,
      `${path}?limit=${limit}`,
    );
    // Filter rows missing the nested object rather than throwing on a non-null assertion.
    const results = [];
    for (const row of data) {
      if (type === "movie" && row.movie) results.push(mapMovie(row.movie));
      else if (type === "tv" && row.show) results.push(mapShow(row.show));
    }
    return results;
  },

  async getAnticipated(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type = "movie", limit = 20 } = input as { type?: "movie" | "tv"; limit?: number };
    const path = type === "movie" ? "/movies/anticipated" : "/shows/anticipated";
    const data = await traktJson<
      Array<{ list_count: number; movie?: TraktMovie; show?: TraktShow }>
    >(c, `${path}?limit=${limit}`);
    // Filter rows missing the nested object rather than throwing on a non-null assertion.
    const results = [];
    for (const row of data) {
      if (type === "movie" && row.movie) results.push(mapMovie(row.movie));
      else if (type === "tv" && row.show) results.push(mapShow(row.show));
    }
    return results;
  },
};
