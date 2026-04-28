import type { LibraryItem } from "@ent-mcp/plugin-sdk";
import type { Ctx, JellyfinItem } from "../types";
import { getUserCfg, getUserId, getExternalBase, jellyfinJson } from "../client";
import { mapItemType, mapLibraryItem, ticksToMs } from "../mappers";

export const continueWatching = {
  async getContinueWatching(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const { type, limit = 20 } = input as {
      type?: "movie" | "show";
      limit?: number;
    };
    const userId = getUserId(typedCtx);
    const externalBase = getExternalBase(getUserCfg(typedCtx));
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const resumeParams = new URLSearchParams({
      Limit: String(safeLimit),
      Fields: "ProviderIds,MediaSources,DateCreated,UserData",
    });
    if (type === "movie") resumeParams.set("MediaTypes", "Video");
    const resume = await jellyfinJson<{ Items: JellyfinItem[] }>(
      typedCtx,
      `/Users/${userId}/Items/Resume?${resumeParams.toString()}`,
    );
    type Entry = {
      item: LibraryItem;
      progressMs?: number;
      nextUp?: LibraryItem;
      lastPlayedAt?: string;
    };
    const entries: Entry[] = [];
    for (const row of resume.Items ?? []) {
      const capType = mapItemType(row.Type);
      if (!capType) continue;
      if (type === "movie" && capType !== "movie") continue;
      if (type === "show" && capType === "movie") continue;
      const item = mapLibraryItem(row, externalBase);
      if (!item) continue;
      const entry: Entry = { item };
      const progressMs = ticksToMs(row.UserData?.PlaybackPositionTicks);
      if (progressMs > 0) entry.progressMs = progressMs;
      if (row.UserData?.LastPlayedDate) entry.lastPlayedAt = row.UserData.LastPlayedDate;
      entries.push(entry);
    }
    if (type !== "movie") {
      const nextUpParams = new URLSearchParams({
        UserId: userId,
        Limit: String(safeLimit),
        Fields: "ProviderIds,MediaSources,DateCreated,UserData",
      });
      const nextUp = await jellyfinJson<{ Items: JellyfinItem[] }>(
        typedCtx,
        `/Shows/NextUp?${nextUpParams.toString()}`,
      );
      for (const row of nextUp.Items ?? []) {
        const item = mapLibraryItem(row, externalBase);
        if (!item) continue;
        if (entries.some((e) => e.item.id === item.id)) continue;
        entries.push({ item });
      }
    }
    return entries.slice(0, safeLimit);
  },
};
