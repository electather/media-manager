import { traktJson, traktJsonWrite } from "../client";
import { toSyncBody, mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow, TraktMediaItemRef } from "../types";

export const collection = {
  async getCollection(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type } = input as { type?: "movie" | "tv" };
    if (type === "movie") {
      const data = await traktJson<Array<{ collected_at: string; movie: TraktMovie }>>(
        c,
        "/sync/collection/movies",
      );
      return data.map((row) => ({ item: mapMovie(row.movie), addedAt: row.collected_at }));
    }
    if (type === "tv") {
      const data = await traktJson<Array<{ last_collected_at: string; show: TraktShow }>>(
        c,
        "/sync/collection/shows",
      );
      return data.map((row) => ({ item: mapShow(row.show), addedAt: row.last_collected_at }));
    }
    // No type filter — fetch both and merge.
    const [movies, shows] = await Promise.all([
      traktJson<Array<{ collected_at: string; movie: TraktMovie }>>(c, "/sync/collection/movies"),
      traktJson<Array<{ last_collected_at: string; show: TraktShow }>>(c, "/sync/collection/shows"),
    ]);
    return [
      ...movies.map((row) => ({ item: mapMovie(row.movie), addedAt: row.collected_at })),
      ...shows.map((row) => ({ item: mapShow(row.show), addedAt: row.last_collected_at })),
    ];
  },

  async addToCollection(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const body = await traktJsonWrite<{ added?: { movies?: number; episodes?: number } }>(
      c,
      "/sync/collection",
      { method: "POST", body: toSyncBody(input as TraktMediaItemRef[]) },
    );
    return { added: (body.added?.movies ?? 0) + (body.added?.episodes ?? 0) };
  },

  async removeFromCollection(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const body = await traktJsonWrite<{ deleted?: { movies?: number; episodes?: number } }>(
      c,
      "/sync/collection/remove",
      { method: "POST", body: toSyncBody(input as TraktMediaItemRef[]) },
    );
    return { removed: (body.deleted?.movies ?? 0) + (body.deleted?.episodes ?? 0) };
  },
};
