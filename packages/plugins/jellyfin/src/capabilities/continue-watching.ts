import type { LibraryItem } from "@nama/plugin-sdk";
import type { Ctx, JellyfinItem, JellyfinProviderIds } from "../types";
import { getUserCfg, getUserId, getExternalBase, jellyfinJson } from "../client";
import { mapItemType, mapLibraryItem, ticksToMs } from "../mappers";

/**
 * Episode items returned by `/Users/{id}/Items/Resume` and `/Shows/NextUp`
 * carry IMDB / TVDB ids on `ProviderIds` but the show-level TMDB id only
 * lives on the parent series record. Without backfilling, the host's home
 * feed cannot key these entries against TMDB and the row collapses to
 * empty. Fetches series-level provider ids in a single batch (de-duped on
 * `SeriesId`) and merges them onto each episode entry's `ids`.
 */
async function fetchSeriesProviderIds(
  ctx: Ctx,
  userId: string,
  seriesIds: string[],
): Promise<Map<string, JellyfinProviderIds>> {
  const out = new Map<string, JellyfinProviderIds>();
  if (seriesIds.length === 0) return out;
  const params = new URLSearchParams({
    Ids: seriesIds.join(","),
    Fields: "ProviderIds",
  });
  const res = await jellyfinJson<{
    Items?: Array<{ Id: string; ProviderIds?: JellyfinProviderIds }>;
  }>(ctx, `/Users/${userId}/Items?${params.toString()}`);
  for (const row of res.Items ?? []) {
    if (row.Id && row.ProviderIds) out.set(row.Id, row.ProviderIds);
  }
  return out;
}

function mergeSeriesIds(
  item: LibraryItem,
  seriesIds: JellyfinProviderIds | undefined,
): LibraryItem {
  if (!seriesIds) return item;
  const merged: Record<string, string> = { ...item.ids };
  // Only fill missing keys — the episode's own ProviderIds (when present)
  // is more specific and stays authoritative.
  if (seriesIds.Tmdb && !merged.tmdb) merged.tmdb = seriesIds.Tmdb;
  if (seriesIds.Imdb && !merged.imdb) merged.imdb = seriesIds.Imdb;
  if (seriesIds.Tvdb && !merged.tvdb) merged.tvdb = seriesIds.Tvdb;
  if (Object.keys(merged).length === 0) return item;
  return { ...item, ids: merged };
}

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
      Fields: "ProviderIds,MediaSources,DateCreated,UserData,SeriesId",
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
      /** Captured during initial mapping so the post-fetch merge knows which entries to backfill. */
      _seriesId?: string;
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
      if (row.SeriesId) entry._seriesId = row.SeriesId;
      const progressMs = ticksToMs(row.UserData?.PlaybackPositionTicks);
      if (progressMs > 0) entry.progressMs = progressMs;
      if (row.UserData?.LastPlayedDate) entry.lastPlayedAt = row.UserData.LastPlayedDate;
      entries.push(entry);
    }
    // Resume covers in-progress items across movies + episodes; NextUp
    // adds the newest unwatched episodes per show. Only fire NextUp
    // when the caller did not pin the result set to movies.
    if (type !== "movie") {
      const nextUpParams = new URLSearchParams({
        UserId: userId,
        Limit: String(safeLimit),
        Fields: "ProviderIds,MediaSources,DateCreated,UserData,SeriesId",
      });
      const nextUp = await jellyfinJson<{ Items: JellyfinItem[] }>(
        typedCtx,
        `/Shows/NextUp?${nextUpParams.toString()}`,
      );
      for (const row of nextUp.Items ?? []) {
        const item = mapLibraryItem(row, externalBase);
        if (!item) continue;
        // Skip episodes already surfaced via Resume so the feed does
        // not double-count them.
        if (entries.some((e) => e.item.id === item.id)) continue;
        const entry: Entry = { item };
        if (row.SeriesId) entry._seriesId = row.SeriesId;
        entries.push(entry);
      }
    }
    const seriesIds = [...new Set(entries.map((e) => e._seriesId).filter((v): v is string => !!v))];
    const seriesProviderIds = await fetchSeriesProviderIds(typedCtx, userId, seriesIds);
    return entries.slice(0, safeLimit).map(({ _seriesId, ...rest }) => ({
      ...rest,
      item: _seriesId ? mergeSeriesIds(rest.item, seriesProviderIds.get(_seriesId)) : rest.item,
    }));
  },
};
