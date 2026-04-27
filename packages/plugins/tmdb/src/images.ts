import { MAX_VARIANTS_PER_KIND } from "@ent-mcp/plugin-sdk";
import type { Ctx, TmdbImage } from "./types";
import { DEFAULT_POSTER_BASE, DEFAULT_ARTWORK_SIZES } from "./constants";
import type { ArtworkSizeKind } from "./constants";

export function artworkBase(ctx: Ctx): string {
  // Strip any size segment baked into imageBaseUrl so artwork URL
  // construction stays self-contained — `getArtwork` builds per-kind size
  // segments itself rather than reusing the poster default.
  const override = ctx.config.global?.imageBaseUrl;
  const base = override ?? "https://image.tmdb.org/t/p";
  // Drop trailing "/w<NNN>" or "/original" suffix if user set the full URL.
  return base.replace(/\/(w\d+|original)\/?$/, "").replace(/\/$/, "");
}

export function artworkSize(ctx: Ctx, kind: ArtworkSizeKind): string {
  const override = ctx.config.global?.artworkSizes?.[kind];
  return override ?? DEFAULT_ARTWORK_SIZES[kind];
}

function imageBase(ctx: Ctx): string {
  const override = ctx.config.global?.imageBaseUrl;
  return override ? `${override.replace(/\/$/, "")}/w500` : DEFAULT_POSTER_BASE;
}

export function buildPosterUrl(ctx: Ctx, path: string | null): string | null {
  return path ? `${imageBase(ctx)}${path}` : null;
}

export function mapTmdbImages(
  images: TmdbImage[] | undefined,
  base: string,
  size: string,
  languages: string[],
): Array<{
  url: string;
  language: string;
  likes: number;
  width?: number;
  height?: number;
}> {
  const TAIL_INDEX = languages.length;
  return (images ?? [])
    .map((i) => ({
      url: `${base}/${size}${i.file_path}`,
      // TMDB uses null for textless; map to fanart's "00" convention so the
      // aggregate dispatch sees a consistent language space across providers.
      language: i.iso_639_1 ?? "00",
      // Approximate fanart's `likes` from TMDB's `vote_average` (0-10) so the
      // sort keys align across providers.
      likes: Math.round(((i.vote_average ?? 0) as number) * 10),
      ...(typeof i.width === "number" ? { width: i.width } : {}),
      ...(typeof i.height === "number" ? { height: i.height } : {}),
    }))
    .sort((a, b) => {
      const ai = languages.indexOf(a.language);
      const bi = languages.indexOf(b.language);
      const aRank = ai === -1 ? TAIL_INDEX : ai;
      const bRank = bi === -1 ? TAIL_INDEX : bi;
      if (aRank !== bRank) return aRank - bRank;
      return b.likes - a.likes;
    })
    .slice(0, MAX_VARIANTS_PER_KIND);
}

/**
 * Translates the capability's `languages` preference list into TMDB's
 * `include_image_language` query string. TMDB writes textless ("no
 * language") variants under the literal string "null"; the caller's "00"
 * convention maps to that. Always includes "null" so textless art is a
 * valid fallback when localised art is missing.
 *
 * Example: `["fr", "en", "00"]` → `"fr,en,null"`.
 *          `["en"]`            → `"en,null"`.
 */
export function buildIncludeImageLanguage(langs: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lang of langs) {
    const mapped = lang === "00" ? "null" : lang;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    out.push(mapped);
  }
  if (!seen.has("null")) out.push("null");
  return out.join(",");
}
