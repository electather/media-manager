import type { LibraryItem } from "@ent-mcp/plugin-sdk";
import type { Ctx, JellyfinItem } from "../types";
import { getUserCfg, getUserId, getExternalBase, jellyfinJson, isNotFound } from "../client";
import { mapLibraryItem, toJfProvider } from "../mappers";

export const libraryAvailability = {
  async checkAvailability(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const { id, idType, type } = input as {
      id: string;
      idType: "tmdb" | "imdb" | "tvdb" | "plex" | "jellyfin";
      type: "movie" | "show";
    };
    if (idType === "jellyfin") {
      try {
        const item = await jellyfinJson<JellyfinItem>(typedCtx, `/Items/${id}`);
        const entry = mapLibraryItem(item, getExternalBase(getUserCfg(typedCtx)));
        return { items: entry ? [entry] : [] };
      } catch (err) {
        if (isNotFound(err)) return { items: [] };
        throw err;
      }
    }
    if (idType === "plex") return { items: [] };
    const provider = toJfProvider(idType);
    const jfType = type === "movie" ? "Movie" : "Series";
    const userId = getUserId(typedCtx);
    const params = new URLSearchParams({
      IncludeItemTypes: jfType,
      Recursive: "true",
      AnyProviderIdEquals: `${provider}.${id}`,
      Fields: "ProviderIds,MediaSources,DateCreated",
    });
    const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
      typedCtx,
      `/Users/${userId}/Items?${params.toString()}`,
    );
    const externalBase = getExternalBase(getUserCfg(typedCtx));
    const items = (data.Items ?? [])
      .map((row) => mapLibraryItem(row, externalBase))
      .filter((x): x is LibraryItem => x !== null);
    return { items };
  },

  async listRecentlyAdded(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const {
      type,
      limit = 20,
      cursor,
    } = input as {
      type?: "movie" | "show";
      limit?: number;
      cursor?: string;
    };
    const userId = getUserId(typedCtx);
    const MAX_PAGE = 50;
    const page = cursor ? Math.min(Math.max(parseInt(cursor, 10) || 1, 1), MAX_PAGE) : 1;
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const params = new URLSearchParams({
      Limit: String(safeLimit * page),
      Fields: "ProviderIds,MediaSources,DateCreated",
    });
    if (type) params.set("IncludeItemTypes", type === "movie" ? "Movie" : "Series");
    const rows = await jellyfinJson<JellyfinItem[]>(
      typedCtx,
      `/Users/${userId}/Items/Latest?${params.toString()}`,
    );
    const slice = rows.slice((page - 1) * safeLimit, page * safeLimit);
    const externalBase = getExternalBase(getUserCfg(typedCtx));
    const items = slice
      .map((row) => mapLibraryItem(row, externalBase))
      .filter((x): x is LibraryItem => x !== null);
    const result: { items: LibraryItem[]; nextCursor?: string } = { items };
    if (rows.length > page * safeLimit) result.nextCursor = String(page + 1);
    return result;
  },

  async searchLibrary(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const {
      query,
      type,
      limit = 20,
    } = input as {
      query: string;
      type?: "movie" | "show";
      limit?: number;
    };
    const userId = getUserId(typedCtx);
    const params = new URLSearchParams({
      SearchTerm: query,
      Recursive: "true",
      Limit: String(Math.min(Math.max(limit, 1), 200)),
      Fields: "ProviderIds,MediaSources,DateCreated",
    });
    if (type) params.set("IncludeItemTypes", type === "movie" ? "Movie" : "Series");
    const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
      typedCtx,
      `/Users/${userId}/Items?${params.toString()}`,
    );
    const externalBase = getExternalBase(getUserCfg(typedCtx));
    return (data.Items ?? [])
      .map((row) => mapLibraryItem(row, externalBase))
      .filter((x): x is LibraryItem => x !== null);
  },
};
