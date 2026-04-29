import { traktJson } from "../client";
import { toSyncBody, mapMovie, mapShow } from "../mappers";
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
    // Skip rows missing both movie and show; matches watch-history.ts so a
    // malformed Trakt row drops out instead of throwing on a non-null assertion.
    const results = [];
    for (const row of data) {
      const item = row.movie ? mapMovie(row.movie) : row.show ? mapShow(row.show) : null;
      if (!item) continue;
      results.push({ item, addedAt: row.listed_at });
    }
    return results;
  },

  async addToWatchlist(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const body = await traktJson<{ added?: { movies?: number; shows?: number } }>(
      c,
      "/sync/watchlist",
      { method: "POST", body: toSyncBody(input as TraktMediaItemRef[]) },
    );
    return { added: (body.added?.movies ?? 0) + (body.added?.shows ?? 0) };
  },

  async removeFromWatchlist(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const body = await traktJson<{ deleted?: { movies?: number; shows?: number } }>(
      c,
      "/sync/watchlist/remove",
      { method: "POST", body: toSyncBody(input as TraktMediaItemRef[]) },
    );
    return { removed: (body.deleted?.movies ?? 0) + (body.deleted?.shows ?? 0) };
  },
};
