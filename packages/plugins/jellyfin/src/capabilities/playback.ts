import { pluginError } from "@ent-mcp/plugin-sdk";
import type { Ctx, JellyfinItem, MediaItemShape } from "../types";
import { getUserId, jellyfinJson, jellyfinFetch } from "../client";
import { mapMediaShape } from "../mappers";

export const playback = {
  async getPositions(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const { type } = input as { type?: "movie" | "tv" };
    const userId = getUserId(typedCtx);
    const params = new URLSearchParams({
      Recursive: "true",
      Filters: "IsResumable",
      Fields: "ProviderIds,MediaSources,DateCreated,UserData",
    });
    if (type === "movie") params.set("IncludeItemTypes", "Movie");
    if (type === "tv") params.set("IncludeItemTypes", "Episode");
    const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
      typedCtx,
      `/Users/${userId}/Items?${params.toString()}`,
    );
    const results: Array<{
      item: MediaItemShape;
      progress: number;
      pausedAt: string;
      season?: number;
      episode?: number;
      playbackId: string;
    }> = [];
    for (const row of data.Items ?? []) {
      const mediaItem = mapMediaShape(row);
      if (!mediaItem) continue;
      if (type && type !== mediaItem.type) continue;
      results.push({
        item: mediaItem,
        progress: Math.min(100, Math.max(0, Math.round(row.UserData?.PlayedPercentage ?? 0))),
        pausedAt: row.UserData?.LastPlayedDate ?? new Date(0).toISOString(),
        season: row.ParentIndexNumber,
        episode: row.IndexNumber,
        playbackId: `jellyfin:${row.Id}`,
      });
    }
    return results;
  },

  async removePosition(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const { playbackId } = input as { playbackId: string };
    const itemId = playbackId.startsWith("jellyfin:")
      ? playbackId.slice("jellyfin:".length)
      : playbackId;
    const userId = getUserId(typedCtx);
    const res = await jellyfinFetch(typedCtx, `/Users/${userId}/Items/${itemId}`, {
      method: "DELETE",
    });
    if (res.status === 401)
      throw pluginError("plugin.token_expired", "Jellyfin auth rejected (401)");
    if (res.status === 429) throw pluginError("plugin.rate_limited", "Jellyfin rate limited (429)");
    if (res.status >= 500)
      throw pluginError("plugin.upstream_error", `Jellyfin server error (${res.status})`);
    return { ok: res.ok || res.status === 404 };
  },
};
