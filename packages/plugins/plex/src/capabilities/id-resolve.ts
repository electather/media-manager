import type { Ctx, PlexMediaContainer, PlexMetadata } from "../types";
import { plexServerJson } from "../client";
import { parseGuids } from "../mappers";

export const idResolve = {
  async resolve(ctx: unknown, input: unknown) {
    const {
      from,
      id,
      type: _type,
    } = input as {
      from: "tmdb" | "tvdb" | "trakt" | "imdb" | "plex:ratingKey" | "jellyfin:itemId";
      id: string;
      type: "movie" | "tv";
    };
    // Plex has no anchor for Jellyfin-local ids, and Trakt ids are not
    // indexed on the server side — both fall through as empty.
    if (from === "jellyfin:itemId" || from === "trakt") return {};

    // A Plex-local ratingKey lookup hits /library/metadata/{id} directly;
    // everything else goes through /library/all?guid=... which indexes by
    // the Guid entries on library items.
    let first: PlexMetadata | undefined;
    if (from === "plex:ratingKey") {
      try {
        const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
          ctx as Ctx,
          `/library/metadata/${encodeURIComponent(id)}`,
        );
        first = body.MediaContainer?.Metadata?.[0];
      } catch (err) {
        if (
          err &&
          typeof err === "object" &&
          (err as { code?: string }).code === "plugin.item_not_found"
        ) {
          return {};
        }
        throw err;
      }
    } else {
      const guid = `${from}://${id}`;
      const body = await plexServerJson<PlexMediaContainer<{ Metadata?: PlexMetadata[] }>>(
        ctx as Ctx,
        `/library/all?guid=${encodeURIComponent(guid)}`,
      );
      first = body.MediaContainer?.Metadata?.[0];
    }
    if (!first) return {};
    const guids = parseGuids(first.Guid);
    const out: Record<string, string> = { "plex:ratingKey": first.ratingKey };
    if (guids["tmdb"]) out["tmdb"] = guids["tmdb"]!;
    if (guids["imdb"]) out["imdb"] = guids["imdb"]!;
    if (guids["tvdb"]) out["tvdb"] = guids["tvdb"]!;
    return out;
  },
};
