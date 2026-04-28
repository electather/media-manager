import { pluginError } from "@ent-mcp/plugin-sdk";
import { traktJson, traktJsonWrite } from "../client";
import { parseTraktId, mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow, TraktMediaItemRef } from "../types";

export const ratings = {
  async getRatings(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type } = input as { type?: "movie" | "tv" };
    const path =
      type === "movie"
        ? "/sync/ratings/movies"
        : type === "tv"
          ? "/sync/ratings/shows"
          : "/sync/ratings";
    const data = await traktJson<
      Array<{
        rated_at: string;
        rating: number;
        movie?: TraktMovie;
        show?: TraktShow;
      }>
    >(c, path);
    return data.map((row) => ({
      item: row.movie ? mapMovie(row.movie) : mapShow(row.show!),
      rating: row.rating,
      ratedAt: row.rated_at,
    }));
  },

  async setRating(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { item, rating } = input as { item: TraktMediaItemRef; rating: number };
    const traktId = parseTraktId(item.ids?.trakt_id);
    if (traktId === null) {
      throw pluginError("plugin.input_invalid", "item.ids.trakt_id required (numeric)");
    }
    const body =
      item.type === "movie"
        ? { movies: [{ rating, ids: { trakt: traktId } }] }
        : { shows: [{ rating, ids: { trakt: traktId } }] };
    await traktJsonWrite(c, "/sync/ratings", { method: "POST", body: JSON.stringify(body) });
    return { ok: true };
  },

  async removeRating(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { item } = input as { item: TraktMediaItemRef };
    const traktId = parseTraktId(item.ids?.trakt_id);
    if (traktId === null) {
      throw pluginError("plugin.input_invalid", "item.ids.trakt_id required (numeric)");
    }
    const body =
      item.type === "movie"
        ? { movies: [{ ids: { trakt: traktId } }] }
        : { shows: [{ ids: { trakt: traktId } }] };
    await traktJsonWrite(c, "/sync/ratings/remove", { method: "POST", body: JSON.stringify(body) });
    return { ok: true };
  },
};
