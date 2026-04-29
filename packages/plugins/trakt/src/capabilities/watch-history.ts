import { traktJsonWrite, traktPaginate } from "../client";
import { toSyncBody, mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow, TraktMediaItemRef } from "../types";

export const watchHistory = {
  async getHistory(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { since } = input as { since?: string };
    const params = new URLSearchParams();
    if (since) params.set("start_at", since);
    const query = params.toString();
    const path = query ? `/sync/history?${query}` : "/sync/history";
    const data = await traktPaginate<{
      id: number;
      watched_at: string;
      type: "movie" | "episode";
      movie?: TraktMovie;
      show?: TraktShow;
    }>(c, path);
    // Trakt history rows can omit the nested media object; skip rather than throw.
    const results = [];
    for (const row of data) {
      const item =
        row.type === "movie" && row.movie
          ? mapMovie(row.movie)
          : row.show
            ? mapShow(row.show)
            : null;
      if (!item) continue;
      results.push({ item, watchedAt: row.watched_at, progress: 100 });
    }
    return results;
  },

  async addToHistory(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const body = await traktJsonWrite<{ added?: { movies?: number; episodes?: number } }>(
      c,
      "/sync/history",
      { method: "POST", body: toSyncBody(input as TraktMediaItemRef[]) },
    );
    return { added: (body.added?.movies ?? 0) + (body.added?.episodes ?? 0) };
  },

  async removeFromHistory(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const body = await traktJsonWrite<{ deleted?: { movies?: number; episodes?: number } }>(
      c,
      "/sync/history/remove",
      { method: "POST", body: toSyncBody(input as TraktMediaItemRef[]) },
    );
    return { removed: (body.deleted?.movies ?? 0) + (body.deleted?.episodes ?? 0) };
  },
};
