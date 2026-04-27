import { definePlugin } from "@ent-mcp/plugin-sdk";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { pluginError, toErrorMessage, MAX_VARIANTS_PER_KIND } from "@ent-mcp/plugin-sdk";
import { handleHttpStatus } from "@ent-mcp/plugin-sdk";

interface TmdbSharedCreds {
  apiKey?: string;
}
interface TmdbUserCreds {
  apiKey?: string;
}
interface TmdbUserCfg {}
// Config keys mirror the artwork@v1 bundle field names so admins reading
// config alongside a response see the same vocabulary in both places.
interface TmdbGlobalCfg {
  imageBaseUrl?: string;
  artworkSizes?: {
    poster?: string;
    backdrop?: string;
    clearLogo?: string;
  };
}

const DEFAULT_ARTWORK_SIZES = {
  poster: "w780",
  backdrop: "w1280",
  clearLogo: "w500",
} as const;

type ArtworkSizeKind = keyof typeof DEFAULT_ARTWORK_SIZES;

function artworkBase(ctx: Ctx): string {
  // Strip any size segment baked into imageBaseUrl so artwork URL
  // construction stays self-contained — `getArtwork` builds per-kind size
  // segments itself rather than reusing the poster default.
  const override = ctx.config.global?.imageBaseUrl;
  const base = override ?? "https://image.tmdb.org/t/p";
  // Drop trailing "/w<NNN>" or "/original" suffix if user set the full URL.
  return base.replace(/\/(w\d+|original)\/?$/, "").replace(/\/$/, "");
}

function artworkSize(ctx: Ctx, kind: ArtworkSizeKind): string {
  const override = ctx.config.global?.artworkSizes?.[kind];
  return override ?? DEFAULT_ARTWORK_SIZES[kind];
}

type Ctx = PluginContext<TmdbUserCreds, TmdbSharedCreds, TmdbUserCfg, TmdbGlobalCfg>;

const BASE = "https://api.themoviedb.org/3";
const DEFAULT_POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const DEFAULT_REGION = "US";

function imageBase(ctx: Ctx): string {
  const override = ctx.config.global?.imageBaseUrl;
  return override ? `${override.replace(/\/$/, "")}/w500` : DEFAULT_POSTER_BASE;
}

function resolveKey(ctx: Ctx): string {
  const value = ctx.credentials?.apiKey ?? ctx.sharedCredentials?.apiKey;
  if (!value) {
    throw pluginError("plugin.bad_credentials", "no TMDB api key available (user or shared)");
  }
  return value;
}

function isBearer(key: string): boolean {
  return key.startsWith("eyJ");
}

function applyAuth(url: URL, key: string): RequestInit {
  if (isBearer(key)) {
    return { headers: { Authorization: `Bearer ${key}` } };
  }
  url.searchParams.set("api_key", key);
  return {};
}

async function tmdbGet(ctx: Ctx, path: string, params: Record<string, unknown> = {}) {
  const url = new URL(`${BASE}${path}`);
  const key = resolveKey(ctx);
  const init = applyAuth(url, key);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v as string | number | boolean | bigint));
  }
  const res = await ctx.fetch(url.toString(), init);
  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get("Retry-After") ?? 0) || undefined;
    ctx.pool.markExhausted({ retryAfterSec });
    throw pluginError("plugin.rate_limited", `TMDB rate-limited (429)`);
  }
  handleHttpStatus(res, "TMDB", {
    on401: "plugin.bad_credentials",
    on403: "plugin.bad_credentials",
  });
  if (!res.ok) {
    throw pluginError("plugin.upstream_error", `TMDB ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function poster(ctx: Ctx, path: string | null): string | null {
  return path ? `${imageBase(ctx)}${path}` : null;
}

interface Genre {
  id: number;
  name: string;
}

interface CastMember {
  name: string;
  order: number;
}

interface CrewMember {
  name: string;
  job: string;
  department: string;
}

interface Credits {
  cast?: CastMember[];
  crew?: CrewMember[];
}

interface Keyword {
  name: string;
}

interface MovieRaw {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  genre_ids?: number[];
  genres?: Genre[];
  runtime?: number | null;
  original_language?: string | null;
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  imdb_id?: string | null;
  credits?: Credits;
  keywords?: { keywords?: Keyword[] };
}

interface TvRaw {
  id: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: Genre[];
  episode_run_time?: number[];
  original_language?: string | null;
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  created_by?: Array<{ name: string }>;
  credits?: Credits;
  keywords?: { results?: Keyword[] };
}

function mapGenres(genres: Genre[] | undefined, genreIds: number[] | undefined): string[] {
  if (genres && genres.length > 0) return genres.map((g) => g.name);
  // Search endpoints return genre_ids only; details endpoints return full genre objects.
  return genreIds ? genreIds.map(String) : [];
}

function mapCast(credits: Credits | undefined): string[] {
  return (credits?.cast ?? []).map((m) => m.name);
}

function mapDirector(credits: Credits | undefined): string | null {
  return credits?.crew?.find((m) => m.job === "Director")?.name ?? null;
}

function mapWriters(credits: Credits | undefined): string[] {
  return (credits?.crew ?? []).filter((m) => m.department === "Writing").map((m) => m.name);
}

function mapMovieKeywords(kw: MovieRaw["keywords"]): string[] {
  return (kw?.keywords ?? []).map((k) => k.name);
}

function mapTvKeywords(kw: TvRaw["keywords"]): string[] {
  return (kw?.results ?? []).map((k) => k.name);
}

function mapMovie(ctx: Ctx, m: MovieRaw): unknown {
  const imdb = m.external_ids?.imdb_id ?? m.imdb_id ?? undefined;
  const tvdb = m.external_ids?.tvdb_id ? String(m.external_ids.tvdb_id) : undefined;
  return {
    id: `movie:${m.id}`,
    title: m.title || m.original_title || "",
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    type: "movie",
    genres: mapGenres(m.genres, m.genre_ids),
    runtime: m.runtime ?? null,
    originalLanguage: m.original_language ?? null,
    cast: mapCast(m.credits),
    director: mapDirector(m.credits),
    writers: mapWriters(m.credits),
    keywords: mapMovieKeywords(m.keywords),
    rating: m.vote_average ?? null,
    overview: m.overview ?? "",
    posterUrl: poster(ctx, m.poster_path ?? null),
    ids: {
      tmdb_id: String(m.id),
      imdb_id: imdb || undefined,
      tvdb_id: tvdb,
    },
  };
}

function mapShow(ctx: Ctx, s: TvRaw): unknown {
  const imdb = s.external_ids?.imdb_id ?? undefined;
  const tvdb = s.external_ids?.tvdb_id ? String(s.external_ids.tvdb_id) : undefined;
  return {
    id: `tv:${s.id}`,
    title: s.name || s.original_name || "",
    year: s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null,
    type: "tv",
    genres: mapGenres(s.genres, s.genre_ids),
    runtime: s.episode_run_time?.[0] ?? null,
    originalLanguage: s.original_language ?? null,
    cast: mapCast(s.credits),
    creators: (s.created_by ?? []).map((c) => c.name),
    keywords: mapTvKeywords(s.keywords),
    rating: s.vote_average ?? null,
    overview: s.overview ?? "",
    posterUrl: poster(ctx, s.poster_path ?? null),
    ids: {
      tmdb_id: String(s.id),
      imdb_id: imdb || undefined,
      tvdb_id: tvdb,
    },
  };
}

export default definePlugin({
  manifest: {
    id: "tmdb",
    name: "The Movie Database",
    version: "2.1.0",
    description:
      "Metadata and id-resolution provider powered by TMDB (themoviedb.org). Admin configures one or more API keys; the host rotates across them on rate-limit.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api.themoviedb.org", "image.tmdb.org"],
    globalConfigSchema: {
      type: "object",
      properties: {
        imageBaseUrl: {
          type: "string",
          format: "uri",
          title: "Image base URL",
          description: "Override the default TMDB image CDN if needed.",
          default: "https://image.tmdb.org/t/p/",
        },
        artworkSizes: {
          type: "object",
          title: "Artwork size buckets",
          description:
            "Path segments used by `artwork@v1.getArtwork`. Keys mirror the bundle field names so admins see the same vocabulary in config and response. Override when serving via a CDN that uses different size names.",
          properties: {
            poster: { type: "string", default: "w780" },
            backdrop: { type: "string", default: "w1280" },
            clearLogo: { type: "string", default: "w500" },
          },
          additionalProperties: false,
        },
      },
      required: [],
    },
    sharedCredentialsSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "TMDB API key (v3 or v4 bearer)",
          "x-secret": true,
        },
      },
      required: ["apiKey"],
    },
    auth: { kind: "none" },
    capabilities: {
      metadata: { version: "v1", scope: "global" },
      idResolve: { version: "v1", scope: "global" },
      watchProviders: { version: "v1", scope: "global" },
      trailers: { version: "v1", scope: "global" },
      artwork: {
        version: "v1",
        scope: "global",
        // TMDB only resolves art for items it knows by tmdb id. IMDB-only
        // movie items fall through to no provider — see fanart spec
        // §"Open Questions / Deferred" → "IMDB-only movie items".
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        // Lower = higher merge priority. TMDB acts as fallback so 20.
        providerPriority: 20,
      },
    },
    poolable: true,
  },

  async verifyShared(ctx) {
    try {
      const key = resolveKey(ctx as Ctx);
      const url = new URL(`${BASE}/configuration`);
      const init = applyAuth(url, key);
      const res = await ctx.fetch(url.toString(), init);
      if (!res.ok) return { ok: false, message: `TMDB ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

  capabilities: {
    metadata: {
      async search(ctx, input) {
        const c = ctx as Ctx;
        const {
          query,
          type,
          limit = 20,
        } = input as { query: string; type?: "movie" | "tv"; limit?: number };
        if (type === "movie") {
          const data = (await tmdbGet(c, "/search/movie", { query })) as { results: MovieRaw[] };
          return data.results.slice(0, limit).map((r) => ({ item: mapMovie(c, r), score: 1 }));
        }
        if (type === "tv") {
          const data = (await tmdbGet(c, "/search/tv", { query })) as { results: TvRaw[] };
          return data.results.slice(0, limit).map((r) => ({ item: mapShow(c, r), score: 1 }));
        }
        const data = (await tmdbGet(c, "/search/multi", { query })) as {
          results: Array<{ media_type: string } & MovieRaw & TvRaw>;
        };
        return data.results
          .filter((r) => r.media_type === "movie" || r.media_type === "tv")
          .slice(0, limit)
          .map((r) => ({
            item: r.media_type === "movie" ? mapMovie(c, r) : mapShow(c, r),
            score: 1,
          }));
      },

      async getDetails(ctx, input) {
        const c = ctx as Ctx;
        const { id, type } = input as { id: string; type: "movie" | "tv" };
        const data = await tmdbGet(c, `/${type}/${id}`, {
          append_to_response: "external_ids,credits,keywords",
        });
        return type === "movie" ? mapMovie(c, data as MovieRaw) : mapShow(c, data as TvRaw);
      },

      async getSimilar(ctx, input) {
        const c = ctx as Ctx;
        const { id, type } = input as { id: string; type: "movie" | "tv" };
        const data = (await tmdbGet(c, `/${type}/${id}/similar`)) as { results: unknown[] };
        return (data.results as Array<MovieRaw & TvRaw>).map((r) =>
          type === "movie" ? mapMovie(c, r) : mapShow(c, r),
        );
      },

      async getTrending(ctx, input) {
        const c = ctx as Ctx;
        const { type = "movie", limit = 20 } = input as {
          type?: "movie" | "tv";
          limit?: number;
        };
        const data = (await tmdbGet(c, `/trending/${type}/day`)) as { results: unknown[] };
        return (data.results as Array<MovieRaw & TvRaw>)
          .slice(0, limit)
          .map((r) => (type === "movie" ? mapMovie(c, r) : mapShow(c, r)));
      },

      async discover(ctx, input) {
        const c = ctx as Ctx;
        const params: Record<string, unknown> = {};
        const {
          genres,
          yearMin,
          yearMax,
          ratingMin,
          limit = 20,
        } = input as {
          genres?: string[];
          yearMin?: number;
          yearMax?: number;
          ratingMin?: number;
          limit?: number;
        };
        if (genres?.length) params["with_genres"] = genres.join(",");
        if (yearMin) params["primary_release_date.gte"] = `${yearMin}-01-01`;
        if (yearMax) params["primary_release_date.lte"] = `${yearMax}-12-31`;
        if (ratingMin) params["vote_average.gte"] = ratingMin;
        const data = (await tmdbGet(c, "/discover/movie", params)) as { results: unknown[] };
        return (data.results as MovieRaw[]).slice(0, limit).map((r) => mapMovie(c, r));
      },
    },

    idResolve: {
      async resolve(ctx, input) {
        const c = ctx as Ctx;
        const { from, id, type } = input as {
          from: "tmdb" | "tvdb" | "trakt" | "imdb";
          id: string;
          type: "movie" | "tv";
        };
        if (from === "tmdb") return { tmdb: id };
        if (from === "imdb") {
          const data = (await tmdbGet(c, `/find/${id}`, { external_source: "imdb_id" })) as {
            movie_results: Array<{ id: number }>;
            tv_results: Array<{ id: number }>;
          };
          const match = type === "movie" ? data.movie_results[0] : data.tv_results[0];
          return match ? { tmdb: String(match.id), imdb: id } : { imdb: id };
        }
        return {};
      },
    },

    watchProviders: {
      async getProviders(ctx, input) {
        const c = ctx as Ctx;
        const { id, type, region } = input as {
          id: string;
          type: "movie" | "tv";
          region?: string;
        };
        const data = (await tmdbGet(c, `/${type}/${id}/watch/providers`)) as {
          results?: Record<
            string,
            {
              flatrate?: Array<{ provider_name: string }>;
              rent?: Array<{ provider_name: string }>;
              buy?: Array<{ provider_name: string }>;
            }
          >;
        };
        // Capability contract documents "US" as the default region when none
        // is supplied by the caller.
        const pick = (data.results ?? {})[region ?? DEFAULT_REGION];
        return {
          streaming: (pick?.flatrate ?? []).map((p) => p.provider_name),
          rent: (pick?.rent ?? []).map((p) => p.provider_name),
          buy: (pick?.buy ?? []).map((p) => p.provider_name),
        };
      },
    },

    trailers: {
      async getVideos(ctx, input) {
        const c = ctx as Ctx;
        const { id, type } = input as { id: string; type: "movie" | "tv" };
        const data = (await tmdbGet(c, `/${type}/${id}/videos`)) as {
          results?: Array<{
            key: string;
            site: string;
            type: string;
            official?: boolean;
          }>;
        };
        return (data.results ?? []).map((v) => ({
          kind: mapVideoKind(v.type),
          site: v.site,
          key: v.key,
          url: buildVideoUrl(v.site, v.key),
          official: v.official,
        }));
      },
    },

    artwork: {
      async getArtwork(ctx, input) {
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

        return {
          poster: mapTmdbImages(data.posters, base, posterSize, langs),
          backdrop: mapTmdbImages(data.backdrops, base, backdropSize, langs),
          clearLogo: mapTmdbImages(data.logos, base, clearLogoSize, langs),
          // TMDB has no thumb concept; empty array lets the per-kind merge
          // fall through to fanart.
          thumb: [],
        };
      },
    },
  },
});

interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  vote_average: number | null;
  width?: number | null;
  height?: number | null;
}

function mapTmdbImages(
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

function mapVideoKind(type: string): "trailer" | "teaser" | "clip" | "featurette" | "other" {
  switch (type) {
    case "Trailer":
      return "trailer";
    case "Teaser":
      return "teaser";
    case "Clip":
      return "clip";
    case "Featurette":
      return "featurette";
    default:
      return "other";
  }
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
function buildIncludeImageLanguage(langs: string[]): string {
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

function buildVideoUrl(site: string, key: string): string | null {
  switch (site) {
    case "YouTube":
      return `https://www.youtube.com/watch?v=${key}`;
    case "Vimeo":
      return `https://vimeo.com/${key}`;
    // Return null for unknown sites rather than the bare key — the `url`
    // schema field is nullable and consumers will treat a non-null value as a
    // real URL. The original `site` and `key` remain on the entry.
    default:
      return null;
  }
}
