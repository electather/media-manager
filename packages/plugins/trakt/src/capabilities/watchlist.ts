import { traktJson, traktJsonWrite } from "../client";
import { splitByType, mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow, TraktMediaItemRef } from "../types";

export const watchlist = {
  async getWatchlist(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type } = input as { type?: "movie" | "tv" };
    const path =
      type === "movie"
        ? "/sync/watchlist/movies"
        : type === "tv"
          ? "/sync/watchlist/shows"
          : "/sync/watchlist";
    const data = await traktJson<
      Array<{
        listed_at: string;
        type: "movie" | "show";
        movie?: TraktMovie;
        show?: TraktShow;
      }>
    >(c, path);
    return data.map((row) => ({
      item: row.movie ? mapMovie(row.movie) : mapShow(row.show!),
      addedAt: row.listed_at,
    }));
  },

  async addToWatchlist(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
    const body = await traktJsonWrite<{ added?: { movies?: number; shows?: number } }>(
      c,
      "/sync/watchlist",
      { method: "POST", body: JSON.stringify({ movies, shows }) },
    );
    return { added: (body.added?.movies ?? 0) + (body.added?.shows ?? 0) };
  },

  async removeFromWatchlist(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
    const body = await traktJsonWrite<{ deleted?: { movies?: number; shows?: number } }>(
      c,
      "/sync/watchlist/remove",
      { method: "POST", body: JSON.stringify({ movies, shows }) },
    );
    return { removed: (body.deleted?.movies ?? 0) + (body.deleted?.shows ?? 0) };
  },
};
