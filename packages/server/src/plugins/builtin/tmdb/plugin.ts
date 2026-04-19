import { definePlugin } from "../../../plugin-runtime/define";
import { PluginError } from "../../../plugin-runtime/types";
import type { PluginContext } from "../../../plugin-runtime/types";

interface TmdbCreds {
  apiKey?: string;
}
interface TmdbUserCfg {}
interface TmdbGlobalCfg {
  apiKey?: string;
}

type Ctx = PluginContext<TmdbCreds, TmdbUserCfg, TmdbGlobalCfg>;

const BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

function resolveKey(ctx: Ctx): string {
  const key = ctx.credentials?.apiKey || ctx.config.global?.apiKey;
  if (!key) {
    throw new PluginError("AUTH_INVALID", "no TMDB api key available (user or global)");
  }
  return key;
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
    url.searchParams.set(k, String(v));
  }
  const res = await ctx.fetch(url.toString(), init);
  if (!res.ok) {
    if (res.status === 401) throw new PluginError("AUTH_INVALID", "TMDB rejected api key");
    throw new PluginError("UPSTREAM_ERROR", `TMDB ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function poster(path: string | null): string | null {
  return path ? `${POSTER_BASE}${path}` : null;
}

function mapMovie(m: {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  genre_ids?: number[];
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
}): unknown {
  return {
    id: `movie:${m.id}`,
    title: m.title || m.original_title || "",
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    type: "movie",
    genres: [],
    rating: m.vote_average ?? null,
    overview: m.overview ?? "",
    posterUrl: poster(m.poster_path ?? null),
    externalIds: { tmdb: String(m.id) },
  };
}

function mapShow(s: {
  id: number;
  name?: string;
  original_name?: string;
  first_air_date?: string;
  genre_ids?: number[];
  vote_average?: number | null;
  overview?: string;
  poster_path?: string | null;
}): unknown {
  return {
    id: `tv:${s.id}`,
    title: s.name || s.original_name || "",
    year: s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null,
    type: "tv",
    genres: [],
    rating: s.vote_average ?? null,
    overview: s.overview ?? "",
    posterUrl: poster(s.poster_path ?? null),
    externalIds: { tmdb: String(s.id) },
  };
}

export default definePlugin({
  manifest: {
    id: "tmdb",
    name: "The Movie Database",
    version: "1.0.2",
    description:
      "Metadata provider powered by TMDB (themoviedb.org). Supports a shared admin-set key or per-user keys.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api.themoviedb.org", "image.tmdb.org"],
    globalConfigSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "TMDB API key (v3)",
          description: "Shared key used when no user key is set.",
        },
      },
      required: ["apiKey"],
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
    },
    auth: { kind: "form" },
    capabilities: {
      metadata: "v1",
      idResolve: "v1",
    },
  },

  async startAuth(ctx, input) {
    const parsed = input as { apiKey?: string } | null;
    if (!parsed?.apiKey) {
      const globalKey = resolveKey(ctx as Ctx);
      if (!globalKey) {
        return {
          status: "error",
          code: "AUTH_INVALID",
          message: "apiKey required (no global key configured)",
        };
      }
      return { status: "completed", credentials: {} };
    }
    // Verify via /configuration — returns 401 for an invalid key or token.
    const url = new URL(`${BASE}/configuration`);
    const init = applyAuth(url, parsed.apiKey);
    const res = await ctx.fetch(url.toString(), init);
    if (!res.ok) {
      return { status: "error", code: "AUTH_INVALID", message: `TMDB ${res.status}` };
    }
    return { status: "completed", credentials: { apiKey: parsed.apiKey } };
  },

  async testConnection(ctx) {
    try {
      const key = resolveKey(ctx as Ctx);
      const url = new URL(`${BASE}/configuration`);
      const init = applyAuth(url, key);
      ctx.log.debug(`Testing TMDB connection with URL: ${url.toString()}`);
      const res = await ctx.fetch(url.toString(), init);
      ctx.log.debug(`TMDB test connection response: ${res.status}`);
      if (!res.ok) return { ok: false, message: `TMDB ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  capabilities: {
    metadata: {
      async search(ctx, input) {
        const {
          query,
          type,
          limit = 20,
        } = input as {
          query: string;
          type?: "movie" | "tv";
          limit?: number;
        };
        if (type === "movie") {
          const data = (await tmdbGet(ctx as Ctx, "/search/movie", { query })) as {
            results: Parameters<typeof mapMovie>[0][];
          };
          return data.results.slice(0, limit).map((r) => ({ item: mapMovie(r), score: 1 }));
        }
        if (type === "tv") {
          const data = (await tmdbGet(ctx as Ctx, "/search/tv", { query })) as {
            results: Parameters<typeof mapShow>[0][];
          };
          return data.results.slice(0, limit).map((r) => ({ item: mapShow(r), score: 1 }));
        }
        const data = (await tmdbGet(ctx as Ctx, "/search/multi", { query })) as {
          results: Array<
            { media_type: string } & Parameters<typeof mapMovie>[0] & Parameters<typeof mapShow>[0]
          >;
        };
        return data.results
          .filter((r) => r.media_type === "movie" || r.media_type === "tv")
          .slice(0, limit)
          .map((r) => ({
            item: r.media_type === "movie" ? mapMovie(r) : mapShow(r),
            score: 1,
          }));
      },

      async getDetails(ctx, input) {
        const { id, type } = input as { id: string; type: "movie" | "tv" };
        const data = await tmdbGet(ctx as Ctx, `/${type}/${id}`);
        return type === "movie"
          ? mapMovie(data as Parameters<typeof mapMovie>[0])
          : mapShow(data as Parameters<typeof mapShow>[0]);
      },

      async getSimilar(ctx, input) {
        const { id, type } = input as { id: string; type: "movie" | "tv" };
        const data = (await tmdbGet(ctx as Ctx, `/${type}/${id}/similar`)) as {
          results: unknown[];
        };
        return (data.results as Parameters<typeof mapMovie>[0][]).map((r) =>
          type === "movie" ? mapMovie(r) : mapShow(r as Parameters<typeof mapShow>[0]),
        );
      },

      async getTrending(ctx, input) {
        const { type = "movie", limit = 20 } = input as { type?: "movie" | "tv"; limit?: number };
        const data = (await tmdbGet(ctx as Ctx, `/trending/${type}/day`)) as {
          results: unknown[];
        };
        return (data.results as Parameters<typeof mapMovie>[0][])
          .slice(0, limit)
          .map((r) =>
            type === "movie" ? mapMovie(r) : mapShow(r as Parameters<typeof mapShow>[0]),
          );
      },

      async discover(ctx, input) {
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
        const data = (await tmdbGet(ctx as Ctx, "/discover/movie", params)) as {
          results: unknown[];
        };
        return (data.results as Parameters<typeof mapMovie>[0][]).slice(0, limit).map(mapMovie);
      },
    },

    idResolve: {
      async resolve(ctx, input) {
        const { from, id, type } = input as {
          from: "tmdb" | "tvdb" | "trakt" | "imdb";
          id: string;
          type: "movie" | "tv";
        };
        if (from === "tmdb") return { tmdb: id };
        if (from === "imdb") {
          const data = (await tmdbGet(ctx as Ctx, `/find/${id}`, {
            external_source: "imdb_id",
          })) as { movie_results: Array<{ id: number }>; tv_results: Array<{ id: number }> };
          const match = type === "movie" ? data.movie_results[0] : data.tv_results[0];
          return match ? { tmdb: String(match.id), imdb: id } : { imdb: id };
        }
        // tvdb / trakt lookups go through TVDB or Trakt plugins.
        return {};
      },
    },
  },
});
