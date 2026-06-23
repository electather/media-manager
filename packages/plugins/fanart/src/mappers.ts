import {
  MAX_VARIANTS_PER_KIND,
  type ArtworkBundle,
  type ArtworkKind,
  type ArtworkVariant,
} from "@nama/plugin-sdk";
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
 * Rewrites asset origin to the admin-configured CDN proxy when present;
 * path stays the same so the proxy can route 1:1. URLs from other origins
 * are returned unchanged.
 */
function rewriteCdn(url: string, override: string | undefined): string {
  if (!override || override === DEFAULT_ASSET_CDN_PREFIX) return url;
  if (url.startsWith(DEFAULT_ASSET_CDN_PREFIX)) {
    return override.replace(/\/$/, "") + url.slice(DEFAULT_ASSET_CDN_PREFIX.length);
  }
  return url;
}

function toVariant(entry: FanartImage, cdnOverride: string | undefined): ArtworkVariant {
  // Fanart uses `lang` (ISO 639-1 or "00" for textless); normalize short
  // garbage values ("e" from truncation) to "00" to pass artwork@v1's min(2)
  // wire schema, matching the provider-agnostic "00" convention.
  const language = entry.lang && entry.lang.length >= 2 ? entry.lang : "00";
  // Fanart returns likes as string; coerce to number for consistency (missing/invalid → 0).
  const parsed = Number(entry.likes);
  const likes = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  return { url: rewriteCdn(entry.url, cdnOverride), language, likes };
}

/**
 * Sorts variants by preferred language order, breaking ties on likes (desc).
 * Unknown languages fall to tail, so ["en", "00"] sees English, textless, then rest.
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
 * Returns a fresh empty bundle so callers can mutate without aliasing
 * a shared default (404 → title not in fanart catalog).
 */
export function emptyBundle(): ArtworkBundle {
  return { poster: [], backdrop: [], clearLogo: [], thumb: [] };
}

/**
 * Maps fanart `/v3/{movies,tv}/{id}` to artwork@v1 bundle; empty input
 * preserves per-kind arrays (spec: "asked, none found" ≠ "didn't ask")
 * so dispatcher merge stays stable.
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
