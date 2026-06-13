import { handleHttpStatus, pluginError } from "@nama/plugin-sdk";
import type { Ctx, JellyfinItem, MediaItemShape } from "../types";
import { getUserId, jellyfinJson, jellyfinFetch } from "../client";
import { mapMediaShape, requireJellyfinItemIds } from "../mappers";

export const watchHistory = {
  async getHistory(ctx: unknown, _input: unknown) {
    const typedCtx = ctx as Ctx;
    const userId = getUserId(typedCtx);
    // Hard cap of 200 items: the capability contract does not yet
    // carry pagination, and 200 is large enough for the current
    // home-feed UX without pulling multi-megabyte responses from
    // large libraries. Users with bigger histories see the 200 most
    // recently played.
    const params = new URLSearchParams({
      Recursive: "true",
      IsPlayed: "true",
      IncludeItemTypes: "Movie,Episode",
      Fields: "ProviderIds,UserData",
      SortBy: "DatePlayed",
      SortOrder: "Descending",
      Limit: "200",
    });
    const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
      typedCtx,
      `/Users/${userId}/Items?${params.toString()}`,
    );
    const results: Array<{
      item: MediaItemShape;
      watchedAt: string;
      progress: number;
    }> = [];
    for (const row of data.Items ?? []) {
      const mediaItem = mapMediaShape(row);
      if (!mediaItem) continue;
      results.push({
        item: mediaItem,
        watchedAt: row.UserData?.LastPlayedDate ?? new Date(0).toISOString(),
        progress: 100,
      });
    }
    return results;
  },

  async addToHistory(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const items = input as Array<{ ids?: { "jellyfin:itemId"?: string } }>;
    const userId = getUserId(typedCtx);
    const itemIds = requireJellyfinItemIds(items, "addToHistory");
    const responses = await Promise.all(
      itemIds.map((itemId) =>
        jellyfinFetch(typedCtx, `/Users/${userId}/PlayedItems/${itemId}`, { method: "POST" }),
      ),
    );
    for (const res of responses) {
      handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
    }
    return { added: responses.filter((r) => r.ok).length };
  },

  async removeFromHistory(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const items = input as Array<{ ids?: { "jellyfin:itemId"?: string } }>;
    const userId = getUserId(typedCtx);
    const itemIds = requireJellyfinItemIds(items, "removeFromHistory");
    const responses = await Promise.all(
      itemIds.map((itemId) =>
        jellyfinFetch(typedCtx, `/Users/${userId}/PlayedItems/${itemId}`, { method: "DELETE" }),
      ),
    );
    for (const res of responses) {
      if (res.status === 401)
        throw pluginError("plugin.token_expired", "Jellyfin auth rejected (401)");
      if (res.status === 429)
        throw pluginError("plugin.rate_limited", "Jellyfin rate limited (429)");
      if (res.status >= 500)
        throw pluginError("plugin.upstream_error", `Jellyfin server error (${res.status})`);
    }
    return { removed: responses.filter((r) => r.ok || r.status === 404).length };
  },
};
