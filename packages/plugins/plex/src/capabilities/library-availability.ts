import { pluginError } from "@nama/plugin-sdk";
import type { Ctx, PlexMediaContainer, PlexMetadata } from "../types";
import { readUserConfig, plexServerJson } from "../client";
import { toLibraryItem, parseGuids } from "../mappers";

export const libraryAvailability = {
  async checkAvailability(ctx: unknown, input: unknown) {
    const {
      id,
      idType,
      type: _type,
    } = input as {
      id: string;
      idType: "tmdb" | "imdb" | "tvdb" | "plex" | "jellyfin";
      type: "movie" | "show";
    };
    const cfg = readUserConfig(ctx as Ctx);

    if (idType === "jellyfin") {
      // Plex cannot resolve Jellyfin-local ids. Surface as "no matches"
      // rather than an error — callers fan out across media-server
      // plugins and should see each one's independent view.
      return { items: [] };
    }

    let path: string;
    if (idType === "plex") {
      path = `/library/metadata/${encodeURIComponent(id)}`;
    } else {
      // Plex indexes items by their Guid entries (`tmdb://`, `imdb://`,
      // `tvdb://`); /library/all?guid=... returns matching items across
      // every section the token can see.
      const guid = `${idType}://${id}`;
      path = `/library/all?guid=${encodeURIComponent(guid)}`;
    }

    try {
      const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
        ctx as Ctx,
        path,
      );
      const metadata = body.MediaContainer?.Metadata ?? [];
      return { items: metadata.map((m) => toLibraryItem(cfg, m)) };
    } catch (err) {
      // A 404 from /library/metadata means the ratingKey is not in the
      // library; treat as "no matches" to match the capability contract.
      if (
        err &&
        typeof err === "object" &&
        (err as { code?: string }).code === "plugin.item_not_found"
      ) {
        return { items: [] };
      }
      throw err;
    }
  },

  async listRecentlyAdded(ctx: unknown, input: unknown) {
    const { limit = 50, cursor } = input as {
      type?: "movie" | "show";
      limit?: number;
      cursor?: string;
    };
    const cfg = readUserConfig(ctx as Ctx);
    const start = cursor ? parseInt(cursor, 10) : 0;
    if (Number.isNaN(start) || start < 0) {
      throw pluginError("plugin.input_invalid", "Plex cursor must be a non-negative integer");
    }
    const params = new URLSearchParams({
      "X-Plex-Container-Start": String(start),
      "X-Plex-Container-Size": String(limit),
    });
    const body = await plexServerJson<
      PlexMediaContainer<{
        Metadata?: PlexMetadata[];
        totalSize?: number;
        size?: number;
      }>
    >(ctx as Ctx, `/library/recentlyAdded?${params.toString()}`);
    const metadata = body.MediaContainer?.Metadata ?? [];
    const items = metadata.map((m) => toLibraryItem(cfg, m));
    const totalSize = body.MediaContainer?.totalSize ?? items.length;
    const returned = body.MediaContainer?.size ?? items.length;
    const next = start + returned;
    return {
      items,
      nextCursor: next < totalSize ? String(next) : undefined,
    };
  },

  async listAvailable(ctx: unknown, input: unknown) {
    const { type } = input as { type: "movie" | "show" };
    // /library/all?type=1|2 returns every item across every section the
    // token can see, with each row's `Guid` array carrying tmdb/imdb/tvdb
    // ids. One scan replaces N per-id `checkAvailability` probes when the
    // host caches the resulting set per (plugin, type) per request.
    const params = new URLSearchParams({
      type: type === "movie" ? "1" : "2",
      // Plex caps a single response by default; raise the ceiling so the
      // index covers the whole library in one round-trip on most servers.
      "X-Plex-Container-Size": "5000",
    });
    const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
      ctx as Ctx,
      `/library/all?${params.toString()}`,
    );
    const metadata = body.MediaContainer?.Metadata ?? [];
    const tmdbIds: string[] = [];
    for (const m of metadata) {
      const guids = parseGuids(m.Guid);
      if (guids["tmdb"]) tmdbIds.push(guids["tmdb"]);
    }
    return { tmdbIds };
  },

  async listShowEpisodes(ctx: unknown, input: unknown) {
    const { id, idType } = input as {
      id: string;
      idType: "tmdb" | "imdb" | "tvdb" | "plex" | "jellyfin";
    };
    if (idType === "jellyfin") return { episodes: [] };

    // Resolve to a Plex ratingKey for the show. Server-local id path skips
    // the resolve step; cross-service ids hit /library/all?guid=... which
    // indexes by the show's Guid entries.
    let ratingKey: string | undefined;
    if (idType === "plex") {
      ratingKey = id;
    } else {
      try {
        const guid = `${idType}://${id}`;
        const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
          ctx as Ctx,
          `/library/all?guid=${encodeURIComponent(guid)}`,
        );
        ratingKey = body.MediaContainer?.Metadata?.[0]?.ratingKey;
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          (err as { code?: string }).code === "plugin.item_not_found"
        ) {
          return { episodes: [] };
        }
        throw err;
      }
    }
    if (!ratingKey) return { episodes: [] };

    try {
      // /allLeaves walks every episode under a show in one round-trip; on
      // 250-episode shows the response is ~50KB, well within the 5-min
      // capability cache.
      const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
        ctx as Ctx,
        `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves`,
      );
      const rows = body.MediaContainer?.Metadata ?? [];
      const episodes: { season: number; episode: number }[] = [];
      for (const m of rows) {
        if (typeof m.parentIndex === "number" && typeof m.index === "number") {
          episodes.push({ season: m.parentIndex, episode: m.index });
        }
      }
      return { episodes };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        (err as { code?: string }).code === "plugin.item_not_found"
      ) {
        return { episodes: [] };
      }
      throw err;
    }
  },

  async searchLibrary(ctx: unknown, input: unknown) {
    const {
      query,
      type,
      limit = 50,
    } = input as {
      query: string;
      type?: "movie" | "show";
      limit?: number;
    };
    const cfg = readUserConfig(ctx as Ctx);
    const params = new URLSearchParams({ query });
    if (type === "movie") params.set("type", "1");
    else if (type === "show") params.set("type", "2");
    // Plex paginates `/search` via the `X-Plex-Container-Size` query
    // parameter; without it the server returns its default page (100–500)
    // and silently ignores the caller's `limit` request.
    params.set("X-Plex-Container-Size", String(limit));
    const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
      ctx as Ctx,
      `/search?${params.toString()}`,
    );
    const metadata = body.MediaContainer?.Metadata ?? [];
    return metadata.map((m) => toLibraryItem(cfg, m));
  },
};
