import { traktPaginate } from "../client";
import { mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow } from "../types";

export const userComments = {
  async getComments(ctx: unknown, _input: unknown) {
    const c = ctx as Ctx;
    const data = await traktPaginate<{
      type: "movie" | "show";
      comment: { text: string; created_at: string };
      movie?: TraktMovie;
      show?: TraktShow;
    }>(c, "/users/me/comments");
    return data
      .filter((row) => row.movie ?? row.show)
      .map((row) => ({
        item: row.movie ? mapMovie(row.movie) : mapShow(row.show!),
        text: row.comment.text,
        createdAt: row.comment.created_at,
      }));
  },
};
