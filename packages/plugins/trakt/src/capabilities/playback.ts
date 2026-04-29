import { handleHttpStatus, pluginError } from "@ent-mcp/plugin-sdk";
import { traktFetch, traktJson } from "../client";
import { mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow } from "../types";

export const playback = {
  async getPositions(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { type } = input as { type?: "movie" | "tv" };
    const path =
      type === "movie"
        ? "/sync/playback/movies"
        : type === "tv"
          ? "/sync/playback/episodes"
          : "/sync/playback";
    const data = await traktJson<
      Array<{
        id: number;
        progress: number;
        paused_at: string;
        type: "movie" | "episode";
        movie?: TraktMovie;
        show?: TraktShow;
        episode?: { season: number; number: number };
      }>
    >(c, path);
    // Rows without a media object are dropped rather than crashing on a non-null assertion.
    const results = [];
    for (const row of data) {
      const item =
        row.type === "movie" && row.movie
          ? mapMovie(row.movie)
          : row.show
            ? mapShow(row.show)
            : null;
      if (!item) continue;
      results.push({
        item,
        progress: row.progress,
        pausedAt: row.paused_at,
        season: row.episode?.season,
        episode: row.episode?.number,
        playbackId: String(row.id),
      });
    }
    return results;
  },

  async removePosition(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { playbackId } = input as { playbackId: string };
    const res = await traktFetch(c, `/sync/playback/${playbackId}`, { method: "DELETE" });
    // 404 means the row is already cleared — treat as idempotent success.
    if (res.status === 404) return { ok: true };
    handleHttpStatus(res, "Trakt", { on401: "plugin.token_expired" });
    if (!res.ok)
      throw pluginError("plugin.upstream_error", `Trakt ${res.status}: ${await res.text()}`);
    return { ok: true };
  },
};
