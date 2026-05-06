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
      // Server-local id: hit the item endpoint directly. A missing
      // server-local id is an empty result, not an error — the
      // caller's cached id may have been deleted upstream.
      try {
        const item = await jellyfinJson<JellyfinItem>(typedCtx, `/Items/${id}`);
        const entry = mapLibraryItem(item, getExternalBase(getUserCfg(typedCtx)));
        return { items: entry ? [entry] : [] };
      } catch (err) {
        if (isNotFound(err)) return { items: [] };
        throw err;
      }
    }
    // Cross-server ids can't be resolved without going through a
    // metadata provider first, which is a deliberate caller
    // responsibility per the capability design.
    if (idType === "plex") return { items: [] };
    const provider = toJfProvider(idType);
    if (!provider) return { items: [] };
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
    // Recent Jellyfin builds (10.10+) silently ignore `AnyProviderIdEquals`
    // and return the full type-filtered library. Re-filter on the client by
    // matching the requested ProviderIds entry — the response already
    // includes `ProviderIds` because we asked for it in `Fields`. Without
    // this guard, every TMDB lookup would report a server copy and the
    // home feed's `availability.hasAnyServerCopy` would be uniformly true.
    const items = (data.Items ?? [])
      .filter((row) => row.ProviderIds?.[provider] === id)
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
    // Jellyfin's /Latest endpoint does not expose a cursor but
    // accepts a `Limit`. Callers paginate by treating `cursor` as a
    // 1-based page index. Cap at MAX_PAGE so a caller passing
    // `cursor: "50000"` cannot ask the server for millions of rows in
    // a single round-trip.
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

  async listAvailable(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const { type } = input as { type: "movie" | "show" };
    const userId = getUserId(typedCtx);
    const jfType = type === "movie" ? "Movie" : "Series";
    // Single library scan returning every TMDB id present. The host caches
    // the response per-request so N enrichment calls collapse to one network
    // round-trip plus N O(1) set lookups (vs. N independent
    // `checkAvailability` probes that each return the entire library on
    // Jellyfin 10.10+ thanks to the broken `AnyProviderIdEquals` filter).
    const params = new URLSearchParams({
      IncludeItemTypes: jfType,
      Recursive: "true",
      Fields: "ProviderIds",
      EnableImages: "false",
      EnableUserData: "false",
    });
    const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
      typedCtx,
      `/Users/${userId}/Items?${params.toString()}`,
    );
    const tmdbIds: string[] = [];
    for (const row of data.Items ?? []) {
      const tmdb = row.ProviderIds?.Tmdb;
      if (tmdb) tmdbIds.push(tmdb);
    }
    return { tmdbIds };
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
