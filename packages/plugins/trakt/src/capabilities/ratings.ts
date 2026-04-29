import { pluginError } from "@ent-mcp/plugin-sdk";
import { traktJson } from "../client";
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
    // Skip rows missing both movie and show; matches watch-history.ts so a
    // malformed Trakt row drops out instead of throwing on a non-null assertion.
    const results = [];
    for (const row of data) {
      const item = row.movie ? mapMovie(row.movie) : row.show ? mapShow(row.show) : null;
      if (!item) continue;
      results.push({ item, rating: row.rating, ratedAt: row.rated_at });
    }
    return results;
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
    await traktJson(c, "/sync/ratings", { method: "POST", body: JSON.stringify(body) });
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
    await traktJson(c, "/sync/ratings/remove", { method: "POST", body: JSON.stringify(body) });
    return { ok: true };
  },
};
