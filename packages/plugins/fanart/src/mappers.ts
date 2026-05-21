import {
  MAX_VARIANTS_PER_KIND,
  type ArtworkBundle,
  type ArtworkKind,
  type ArtworkVariant,
} from "@ent-mcp/plugin-sdk";
import { DEFAULT_ASSET_CDN_PREFIX } from "./constants";
import type { FanartImage, FanartResponse } from "./types";

/**
 * Maps a fanart per-kind field to the artwork@v1 bundle field. Movies and tv
 * use different fanart vocabulary even though both surface as the same
 * `ArtworkBundle` kinds on the wire.
 */
const KIND_KEYS = {
  movie: {
    poster: "movieposter",
    backdrop: "moviebackground",
    clearLogo: "hdmovielogo",
    thumb: "moviethumb",
  },
  tv: {
    poster: "tvposter",
    backdrop: "showbackground",
    clearLogo: "hdtvlogo",
    thumb: "tvthumb",
  },
} as const satisfies Record<"movie" | "tv", Record<ArtworkKind, keyof FanartResponse>>;

const KINDS: readonly ArtworkKind[] = ["poster", "backdrop", "clearLogo", "thumb"];

/**
 * Rewrites the origin of a fanart asset URL to the admin-configured CDN
 * proxy when present. Only the origin is replaced; the path stays as fanart
 * returned it so the proxy can route the asset 1:1. URLs from other origins
 * (none expected today, defensive against future API shape changes) are
 * returned unchanged.
 */
function rewriteCdn(url: string, override: string | undefined): string {
  if (!override || override === DEFAULT_ASSET_CDN_PREFIX) return url;
  if (url.startsWith(DEFAULT_ASSET_CDN_PREFIX)) {
    return override.replace(/\/$/, "") + url.slice(DEFAULT_ASSET_CDN_PREFIX.length);
  }
  return url;
}

function toVariant(entry: FanartImage, cdnOverride: string | undefined): ArtworkVariant {
  // Fanart writes the language tag as `lang` (two-letter ISO 639-1 code, or
  // "00" for textless variants). The artwork@v1 contract keeps the same
  // "00" convention so consumers don't have to special-case across
  // providers. The 2-char minimum also normalises single-character
  // garbage values (e.g. "e" from a truncated payload) to textless rather
  // than letting them through and failing the wire-schema's `min(2)` check
  // downstream.
  const language = entry.lang && entry.lang.length >= 2 ? entry.lang : "00";
  // Fanart serialises `likes` as a string; coerce so the sort comparator
  // and downstream consumers always see a number. Missing/invalid → 0.
  const parsed = Number(entry.likes);
  const likes = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  return { url: rewriteCdn(entry.url, cdnOverride), language, likes };
}

/**
 * Ranks a list of variants by the caller's preferred language order, breaking
 * ties on `likes` descending. Missing/unknown languages fall to the tail so
 * `["en", "00"]` callers still see English first, textless second, then
 * everything else.
 */
function compareByLanguageThenLikes(
  languages: readonly string[],
): (a: ArtworkVariant, b: ArtworkVariant) => number {
  const tailIndex = languages.length;
  return (a, b) => {
    const ai = languages.indexOf(a.language);
    const bi = languages.indexOf(b.language);
    const aRank = ai === -1 ? tailIndex : ai;
    const bRank = bi === -1 ? tailIndex : bi;
    if (aRank !== bRank) return aRank - bRank;
    return (b.likes ?? 0) - (a.likes ?? 0);
  };
}

function mapKind(
  raw: FanartImage[] | undefined,
  languages: readonly string[],
  cdnOverride: string | undefined,
): ArtworkVariant[] {
  if (!raw || raw.length === 0) return [];
  return raw
    .filter((entry) => typeof entry.url === "string" && entry.url.length > 0)
    .map((entry) => toVariant(entry, cdnOverride))
    .sort(compareByLanguageThenLikes(languages))
    .slice(0, MAX_VARIANTS_PER_KIND);
}

/**
 * Empty bundle returned when a 404 response indicates the title is absent
 * from fanart's catalog. Always returns a fresh object so callers can mutate
 * it without aliasing a shared default.
 */
export function emptyBundle(): ArtworkBundle {
  return { poster: [], backdrop: [], clearLogo: [], thumb: [] };
}

/**
 * Shapes a fanart `/v3/movies/{id}` or `/v3/tv/{id}` payload into the
 * `artwork@v1` bundle. Empty input keeps the bundle's per-kind arrays
 * present (per spec, "asked, none found" is distinct from "didn't ask"), so
 * the dispatcher's per-kind merge keeps a stable shape to walk.
 */
export function shapeBundle(
  json: FanartResponse,
  type: "movie" | "tv",
  languages: readonly string[],
  cdnOverride: string | undefined,
): ArtworkBundle {
  const keys = KIND_KEYS[type];
  const out = emptyBundle();
  for (const kind of KINDS) {
    out[kind] = mapKind(json[keys[kind]] as FanartImage[] | undefined, languages, cdnOverride);
  }
  return out;
}
