import { traktJson } from "../client";
import type { Ctx, TraktMovie, TraktShow } from "../types";

export const idResolve = {
  async resolve(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { from, id, type } = input as {
      from: "tmdb" | "tvdb" | "trakt" | "imdb";
      id: string;
      type: "movie" | "tv";
    };
    if (from === "trakt") return { trakt: id };
    const idType = from === "imdb" ? "imdb" : from === "tmdb" ? "tmdb" : "tvdb";
    const kind = type === "movie" ? "movie" : "show";
    const data = await traktJson<Array<{ type: string; movie?: TraktMovie; show?: TraktShow }>>(
      c,
      `/search/${idType}/${id}?type=${kind}`,
    );
    const hit = data[0];
    if (!hit) return {};
    const ids = hit.movie?.ids ?? hit.show?.ids;
    if (!ids) return {};
    return {
      trakt: ids.trakt ? String(ids.trakt) : undefined,
      tmdb: ids.tmdb ? String(ids.tmdb) : undefined,
      tvdb: "tvdb" in ids && ids.tvdb ? String(ids.tvdb as number) : undefined,
      imdb: ids.imdb,
    };
  },
};
