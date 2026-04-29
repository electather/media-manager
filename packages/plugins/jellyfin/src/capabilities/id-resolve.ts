import type { Ctx, JellyfinItem } from "../types";
import { getUserId, jellyfinJson, isNotFound } from "../client";
import { toJfProvider, extractIds } from "../mappers";

export const idResolve = {
  async resolve(ctx: unknown, input: unknown) {
    const typedCtx = ctx as Ctx;
    const { from, id, type } = input as {
      from: "tmdb" | "tvdb" | "trakt" | "imdb" | "plex:ratingKey" | "jellyfin:itemId";
      id: string;
      type: "movie" | "tv";
    };

    if (from === "jellyfin:itemId") {
      try {
        const item = await jellyfinJson<JellyfinItem>(typedCtx, `/Items/${id}`);
        return extractIds(item.ProviderIds, item.Id);
      } catch (err) {
        if (isNotFound(err)) return {};
        throw err;
      }
    }

    // Cross-service handles Jellyfin can't resolve (plex ratingKey,
    // trakt) fall through `toJfProvider` returning null and yield an
    // empty result — preserves the original behaviour without an
    // unsafe cast and stays exhaustive if `from` gains new variants.
    const provider = toJfProvider(from);
    if (!provider) return {};
    const userId = getUserId(typedCtx);
    const jfType = type === "movie" ? "Movie" : "Series";
    const params = new URLSearchParams({
      IncludeItemTypes: jfType,
      Recursive: "true",
      AnyProviderIdEquals: `${provider}.${id}`,
      Fields: "ProviderIds",
    });
    const data = await jellyfinJson<{ Items: JellyfinItem[] }>(
      typedCtx,
      `/Users/${userId}/Items?${params.toString()}`,
    );
    const hit = data.Items?.[0];
    if (!hit) return {};
    return extractIds(hit.ProviderIds, hit.Id);
  },
};
