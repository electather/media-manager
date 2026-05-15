import { pluginError } from "@ent-mcp/plugin-sdk";
import type { Ctx, TmdbImage } from "../types";
import { tmdbGet } from "../client";
import { artworkBase, artworkSize, mapTmdbImages, buildIncludeImageLanguage } from "../images";

export const artwork = {
  async getArtwork(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { ids, type, languages } = input as {
      ids: { tmdb?: string; imdb?: string; tvdb?: string };
      type: "movie" | "tv";
      languages?: string[];
    };
    const tmdbId = ids.tmdb;
    if (!tmdbId) {
      // Defensive — dispatcher's canServe filter should drop us before
      // invoke. Keeps the plugin honest for direct unit tests too.
      throw pluginError("plugin.input_invalid", "TMDB artwork requires ids.tmdb");
    }
    const langs = languages ?? ["en", "00"];
    // Build TMDB's `include_image_language` filter from the caller's
    // language preferences so a request for `["fr","en","00"]` doesn't
    // silently come back English-only. TMDB uses the literal string
    // "null" for textless variants; map "00" → "null" and always include
    // it so textless art can fall through when localised art is missing.
    const includeImageLanguage = buildIncludeImageLanguage(langs);
    // /images is unauthenticated for v3 keys but accepts the same auth
    // shape as the rest of the API; use tmdbGet so 401/403/429 paths are
    // shared.
    const data = (await tmdbGet(c, `/${type}/${tmdbId}/images`, {
      include_image_language: includeImageLanguage,
    })) as {
      posters?: TmdbImage[];
      backdrops?: TmdbImage[];
      logos?: TmdbImage[];
    };

    const base = artworkBase(c);
    const posterSize = artworkSize(c, "poster");
    const backdropSize = artworkSize(c, "backdrop");
    const clearLogoSize = artworkSize(c, "clearLogo");
    // Backdrops are background art behind localised text in the UI, so
    // textless variants ("00") rank above any language-tagged version.
    // Posters and logos keep the caller's preference order since their
    // baked-in text is the point.
    const backdropLangs = ["00", ...langs.filter((l) => l !== "00")];

    return {
      poster: mapTmdbImages(data.posters, base, posterSize, langs),
      backdrop: mapTmdbImages(data.backdrops, base, backdropSize, backdropLangs),
      clearLogo: mapTmdbImages(data.logos, base, clearLogoSize, langs),
      // TMDB has no thumb concept; empty array lets the per-kind merge
      // fall through to fanart.
      thumb: [],
    };
  },
};
