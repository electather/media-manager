import type { Ctx } from "../types";
import { tmdbGet } from "../client";

export const idResolve = {
  async resolve(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { from, id, type } = input as {
      from: "tmdb" | "tvdb" | "trakt" | "imdb";
      id: string;
      type: "movie" | "tv";
    };
    if (from === "tmdb") return { tmdb: id };
    if (from === "imdb") {
      const data = (await tmdbGet(c, `/find/${id}`, { external_source: "imdb_id" })) as {
        movie_results: Array<{ id: number }>;
        tv_results: Array<{ id: number }>;
      };
      const match = type === "movie" ? data.movie_results[0] : data.tv_results[0];
      return match ? { tmdb: String(match.id), imdb: id } : { imdb: id };
    }
    return {};
  },
};
