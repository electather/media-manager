import { definePlugin } from "../../../plugin-runtime/define";
import type { PluginContext } from "../../../plugin-runtime/types";
import { pluginError, toErrorMessage } from "../../utils/plugin-error";
import { handleHttpStatus } from "../../utils/http-status";
import { resolveCredential } from "../../utils/credentials";

interface TmdbCreds {
  apiKey?: string;
}
interface TmdbUserCfg {}
interface TmdbGlobalCfg {
  imageBaseUrl?: string;
}

type Ctx = PluginContext<TmdbCreds, TmdbUserCfg, TmdbGlobalCfg>;

const BASE = "https://api.themoviedb.org/3";
const DEFAULT_POSTER_BASE = "https://image.tmdb.org/t/p/w500";

function imageBase(ctx: Ctx): string {
  const override = ctx.config.global?.imageBaseUrl;
  return override ? `${override.replace(/\/$/, "")}/w500` : DEFAULT_POSTER_BASE;
}

function resolveKey(ctx: Ctx): string {
  return resolveCredential(
    ctx.credentials?.apiKey,
    ctx.sharedCredentials?.apiKey,
    "no TMDB api key available (user or shared)",
  );
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

interface MovieRaw {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  genre_ids?: number[];
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  imdb_id?: string | null;
}

interface TvRaw {
  id: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  genre_ids?: number[];
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
}

function mapMovie(ctx: Ctx, m: MovieRaw): unknown {
  const imdb = m.external_ids?.imdb_id ?? m.imdb_id ?? undefined;
  const tvdb = m.external_ids?.tvdb_id ? String(m.external_ids.tvdb_id) : undefined;
  return {
    id: `movie:${m.id}`,
    title: m.title || m.original_title || "",
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    type: "movie",
    genres: [],
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
    genres: [],
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
    version: "1.1.0",
    description:
      "Metadata provider powered by TMDB (themoviedb.org). Admin can set a shared API key; users may override with a personal key.",
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
      },
      required: [],
    },
    userConfigSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "Your personal TMDB API key (v3)",
          "x-secret": true,
        },
      },
      additionalProperties: false,
    },
    credentialsSchema: {
      type: "object",
      properties: {
        apiKey: { type: "string" },
      },
      required: ["apiKey"],
    },
    allowsSharedCredentials: true,
    auth: { kind: "form" },
    capabilities: {
      metadata: "v1",
      idResolve: "v1",
    },
  },

  async startAuth(ctx, input) {
    const parsed = input as { apiKey?: string } | null;
    if (!parsed?.apiKey) {
      try {
        resolveKey(ctx as Ctx);
        return { status: "completed", credentials: {} };
      } catch {
        return {
          status: "error",
          code: "plugin.bad_credentials",
          devMessage: "apiKey required (no shared key configured)",
        };
      }
    }
    const url = new URL(`${BASE}/configuration`);
    const init = applyAuth(url, parsed.apiKey);
    const res = await ctx.fetch(url.toString(), init);
    if (!res.ok) {
      return { status: "error", code: "plugin.bad_credentials", devMessage: `TMDB ${res.status}` };
    }
    return { status: "completed", credentials: { apiKey: parsed.apiKey } };
  },

  async testConnection(ctx) {
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
        const data = await tmdbGet(c, `/${type}/${id}`, { append_to_response: "external_ids" });
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
  },
});
