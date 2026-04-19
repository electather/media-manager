import { definePlugin } from "../../../plugin-runtime/define";
import type { AuthResult, PluginContext } from "../../../plugin-runtime/types";
import { pluginError, toErrorMessage } from "../../utils/plugin-error";
import { handleHttpStatus } from "../../utils/http-status";

interface TraktCreds {
  accessToken: string;
  refreshToken: string;
  createdAt: number;
  expiresIn: number;
}
interface TraktUserCfg {}
interface TraktGlobalCfg {
  clientId: string;
  clientSecret: string;
}

type Ctx = PluginContext<TraktCreds, TraktUserCfg, TraktGlobalCfg>;

const BASE = "https://api.trakt.tv";

function traktHeaders(ctx: Ctx): Record<string, string> {
  const clientId = ctx.config.global?.clientId;
  if (!clientId) {
    throw pluginError("plugin.bad_credentials", "Trakt clientId missing from global config");
  }
  const h: Record<string, string> = {
    "content-type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
  };
  if (ctx.credentials?.accessToken) {
    h["Authorization"] = `Bearer ${ctx.credentials.accessToken}`;
  }
  return h;
}

async function traktFetch(ctx: Ctx, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...traktHeaders(ctx), ...(init.headers as Record<string, string>) };
  return ctx.fetch(`${BASE}${path}`, { ...init, headers });
}

async function traktJson<T>(ctx: Ctx, path: string, init: RequestInit = {}): Promise<T> {
  const res = await traktFetch(ctx, path, init);
  handleHttpStatus(res, "Trakt", { on401: "plugin.token_expired" });
  if (!res.ok)
    throw pluginError("plugin.upstream_error", `Trakt ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface TraktMovie {
  ids: { trakt: number; slug: string; imdb?: string; tmdb?: number };
  title: string;
  year: number | null;
  overview?: string;
}
interface TraktShow {
  ids: { trakt: number; slug: string; imdb?: string; tmdb?: number; tvdb?: number };
  title: string;
  year: number | null;
  overview?: string;
}

function mapMovie(m: TraktMovie) {
  return {
    id: `movie:${m.ids.tmdb ?? m.ids.trakt}`,
    title: m.title,
    year: m.year ?? null,
    type: "movie" as const,
    genres: [],
    rating: null,
    overview: m.overview ?? "",
    posterUrl: null,
    ids: {
      tmdb_id: m.ids.tmdb ? String(m.ids.tmdb) : undefined,
      trakt_id: String(m.ids.trakt),
      trakt_slug: m.ids.slug,
      imdb_id: m.ids.imdb,
    },
  };
}

function mapShow(s: TraktShow) {
  return {
    id: `tv:${s.ids.tmdb ?? s.ids.trakt}`,
    title: s.title,
    year: s.year ?? null,
    type: "tv" as const,
    genres: [],
    rating: null,
    overview: s.overview ?? "",
    posterUrl: null,
    ids: {
      tmdb_id: s.ids.tmdb ? String(s.ids.tmdb) : undefined,
      trakt_id: String(s.ids.trakt),
      trakt_slug: s.ids.slug,
      tvdb_id: s.ids.tvdb ? String(s.ids.tvdb) : undefined,
      imdb_id: s.ids.imdb,
    },
  };
}

function readTraktId(item: {
  ids?: { trakt_id?: string };
  externalIds?: { trakt?: string };
}): string | undefined {
  return item.ids?.trakt_id ?? item.externalIds?.trakt;
}

export default definePlugin({
  manifest: {
    id: "trakt",
    name: "Trakt",
    version: "1.1.0",
    description: "Watch history, watchlist, ratings, recommendations, and calendar via Trakt.tv.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api.trakt.tv"],
    globalConfigSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", title: "Trakt client id" },
        clientSecret: { type: "string", title: "Trakt client secret" },
      },
      required: ["clientId", "clientSecret"],
    },
    userConfigSchema: { type: "object", properties: {}, additionalProperties: false },
    credentialsSchema: {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        createdAt: { type: "number" },
        expiresIn: { type: "number" },
      },
      required: ["accessToken", "refreshToken", "createdAt", "expiresIn"],
    },
    auth: { kind: "oauth_device" },
    capabilities: {
      watchHistory: "v1",
      watchlist: "v1",
      ratings: "v1",
      recommendations: "v1",
      calendar: "v1",
      idResolve: "v1",
    },
    jobs: [
      {
        id: "refresh-tokens",
        schedule: "*/30 * * * *",
        handler: "refreshTokens",
        perConnection: true,
      },
    ],
  },

  async startAuth(ctx) {
    const global = ctx.config.global as TraktGlobalCfg | null;
    const clientId = global?.clientId;
    if (!clientId) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "Trakt clientId not configured",
      };
    }
    const res = await ctx.fetch(`${BASE}/oauth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    });
    if (!res.ok) {
      return { status: "error", code: "plugin.upstream_error", devMessage: `Trakt ${res.status}` };
    }
    const body = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_url: string;
      expires_in: number;
      interval: number;
    };
    return {
      status: "display_code",
      code: body.user_code,
      verifyUrl: body.verification_url,
      pollState: { device_code: body.device_code },
      intervalSec: body.interval,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
  },

  async pollAuth(ctx, pollState): Promise<AuthResult> {
    const state = pollState as { device_code: string };
    const global = ctx.config.global as TraktGlobalCfg | null;
    const clientId = global?.clientId;
    const clientSecret = global?.clientSecret;
    if (!clientId || !clientSecret) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "Trakt client not configured",
      };
    }
    const res = await ctx.fetch(`${BASE}/oauth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: state.device_code,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (res.status === 400) return { status: "pending" };
    if (res.status === 429) return { status: "pending" };
    if (res.status === 404 || res.status === 410 || res.status === 418) {
      return {
        status: "error",
        code: "plugin.token_expired",
        devMessage: "device code expired or denied",
      };
    }
    if (!res.ok) {
      return { status: "error", code: "plugin.upstream_error", devMessage: `Trakt ${res.status}` };
    }
    const body = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      created_at: number;
      expires_in: number;
    };
    return {
      status: "completed",
      credentials: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        createdAt: body.created_at * 1000,
        expiresIn: body.expires_in,
      },
    };
  },

  async refreshAuth(ctx, credentials) {
    const creds = credentials as TraktCreds;
    const global = ctx.config.global as TraktGlobalCfg | null;
    const clientId = global?.clientId;
    const clientSecret = global?.clientSecret;
    if (!clientId || !clientSecret) {
      throw pluginError("plugin.bad_credentials", "Trakt client not configured");
    }
    const res = await ctx.fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        refresh_token: creds.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
      }),
    });
    if (!res.ok) throw pluginError("plugin.token_expired", `Trakt refresh ${res.status}`);
    const body = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      created_at: number;
      expires_in: number;
    };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      createdAt: body.created_at * 1000,
      expiresIn: body.expires_in,
    };
  },

  async testConnection(ctx) {
    try {
      const res = await traktFetch(ctx as Ctx, "/users/settings");
      if (res.status === 401) return { ok: false, message: "token invalid or expired" };
      if (!res.ok) return { ok: false, message: `Trakt ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

  capabilities: {
    watchHistory: {
      async getHistory(ctx, input) {
        const { limit = 50, since } = input as { limit?: number; since?: string };
        const params = new URLSearchParams();
        params.set("limit", String(limit));
        if (since) params.set("start_at", since);
        const data = await traktJson<
          Array<{
            id: number;
            watched_at: string;
            type: "movie" | "episode";
            movie?: TraktMovie;
            show?: TraktShow;
          }>
        >(ctx as Ctx, `/sync/history?${params.toString()}`);
        return data.map((row) => ({
          item: row.type === "movie" && row.movie ? mapMovie(row.movie) : mapShow(row.show!),
          watchedAt: row.watched_at,
          progress: 100,
        }));
      },

      async addToHistory(ctx, input) {
        const items = input as Array<{
          type: "movie" | "tv";
          ids?: { trakt_id?: string };
          externalIds?: { trakt?: string };
        }>;
        const movies = items
          .filter((i) => i.type === "movie" && readTraktId(i))
          .map((i) => ({ ids: { trakt: Number(readTraktId(i)) } }));
        const shows = items
          .filter((i) => i.type === "tv" && readTraktId(i))
          .map((i) => ({ ids: { trakt: Number(readTraktId(i)) } }));
        const res = await traktFetch(ctx as Ctx, "/sync/history", {
          method: "POST",
          body: JSON.stringify({ movies, shows }),
        });
        if (!res.ok) throw pluginError("plugin.upstream_error", `Trakt ${res.status}`);
        const body = (await res.json()) as { added?: { movies?: number; episodes?: number } };
        return { added: (body.added?.movies ?? 0) + (body.added?.episodes ?? 0) };
      },
    },

    watchlist: {
      async getWatchlist(ctx, input) {
        const { type } = input as { type?: "movie" | "tv" };
        const path =
          type === "movie"
            ? "/sync/watchlist/movies"
            : type === "tv"
              ? "/sync/watchlist/shows"
              : "/sync/watchlist";
        const data = await traktJson<
          Array<{
            listed_at: string;
            type: "movie" | "show";
            movie?: TraktMovie;
            show?: TraktShow;
          }>
        >(ctx as Ctx, path);
        return data.map((row) => ({
          item: row.movie ? mapMovie(row.movie) : mapShow(row.show!),
          addedAt: row.listed_at,
        }));
      },

      async addToWatchlist(ctx, input) {
        const items = input as Array<{
          type: "movie" | "tv";
          ids?: { trakt_id?: string };
          externalIds?: { trakt?: string };
        }>;
        const movies = items
          .filter((i) => i.type === "movie" && readTraktId(i))
          .map((i) => ({ ids: { trakt: Number(readTraktId(i)) } }));
        const shows = items
          .filter((i) => i.type === "tv" && readTraktId(i))
          .map((i) => ({ ids: { trakt: Number(readTraktId(i)) } }));
        const res = await traktFetch(ctx as Ctx, "/sync/watchlist", {
          method: "POST",
          body: JSON.stringify({ movies, shows }),
        });
        if (!res.ok) throw pluginError("plugin.upstream_error", `Trakt ${res.status}`);
        const body = (await res.json()) as { added?: { movies?: number; shows?: number } };
        return { added: (body.added?.movies ?? 0) + (body.added?.shows ?? 0) };
      },

      async removeFromWatchlist(ctx, input) {
        const items = input as Array<{
          type: "movie" | "tv";
          ids?: { trakt_id?: string };
          externalIds?: { trakt?: string };
        }>;
        const movies = items
          .filter((i) => i.type === "movie" && readTraktId(i))
          .map((i) => ({ ids: { trakt: Number(readTraktId(i)) } }));
        const shows = items
          .filter((i) => i.type === "tv" && readTraktId(i))
          .map((i) => ({ ids: { trakt: Number(readTraktId(i)) } }));
        const res = await traktFetch(ctx as Ctx, "/sync/watchlist/remove", {
          method: "POST",
          body: JSON.stringify({ movies, shows }),
        });
        if (!res.ok) throw pluginError("plugin.upstream_error", `Trakt ${res.status}`);
        const body = (await res.json()) as { deleted?: { movies?: number; shows?: number } };
        return { removed: (body.deleted?.movies ?? 0) + (body.deleted?.shows ?? 0) };
      },
    },

    ratings: {
      async getRatings(ctx, input) {
        const { type } = input as { type?: "movie" | "tv" };
        const path =
          type === "movie"
            ? "/sync/ratings/movies"
            : type === "tv"
              ? "/sync/ratings/shows"
              : "/sync/ratings";
        const data = await traktJson<
          Array<{
            rated_at: string;
            rating: number;
            movie?: TraktMovie;
            show?: TraktShow;
          }>
        >(ctx as Ctx, path);
        return data.map((row) => ({
          item: row.movie ? mapMovie(row.movie) : mapShow(row.show!),
          rating: row.rating,
          ratedAt: row.rated_at,
        }));
      },

      async setRating(ctx, input) {
        const { item, rating } = input as {
          item: {
            type: "movie" | "tv";
            ids?: { trakt_id?: string };
            externalIds?: { trakt?: string };
          };
          rating: number;
        };
        const traktId = readTraktId(item);
        if (!traktId) {
          throw pluginError("plugin.input_invalid", "item.ids.trakt_id required");
        }
        const body =
          item.type === "movie"
            ? { movies: [{ rating, ids: { trakt: Number(traktId) } }] }
            : { shows: [{ rating, ids: { trakt: Number(traktId) } }] };
        const res = await traktFetch(ctx as Ctx, "/sync/ratings", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { ok: res.ok };
      },
    },

    recommendations: {
      async getRecommendations(ctx, input) {
        const { type = "movie", limit = 20 } = input as {
          type?: "movie" | "tv";
          limit?: number;
        };
        const path = type === "movie" ? "/recommendations/movies" : "/recommendations/shows";
        const data = await traktJson<Array<TraktMovie | TraktShow>>(
          ctx as Ctx,
          `${path}?limit=${limit}`,
        );
        return data.map((row) =>
          type === "movie" ? mapMovie(row as TraktMovie) : mapShow(row as TraktShow),
        );
      },
    },

    calendar: {
      async getUpcoming(ctx, input) {
        const { days = 7 } = input as { days?: number };
        const start = new Date().toISOString().slice(0, 10);
        const data = await traktJson<
          Array<{
            first_aired: string;
            episode: { season: number; number: number; title: string };
            show: TraktShow;
          }>
        >(ctx as Ctx, `/calendars/my/shows/${start}/${days}`);
        return data.map((row) => ({
          item: mapShow(row.show),
          season: row.episode.season,
          episode: row.episode.number,
          episodeTitle: row.episode.title,
          airsAt: row.first_aired,
        }));
      },
    },

    idResolve: {
      async resolve(ctx, input) {
        const { from, id, type } = input as {
          from: "tmdb" | "tvdb" | "trakt" | "imdb";
          id: string;
          type: "movie" | "tv";
        };
        if (from === "trakt") return { trakt: id };
        const idType = from === "imdb" ? "imdb" : from === "tmdb" ? "tmdb" : "tvdb";
        const kind = type === "movie" ? "movie" : "show";
        const data = await traktJson<Array<{ type: string; movie?: TraktMovie; show?: TraktShow }>>(
          ctx as Ctx,
          `/search/${idType}/${id}?type=${kind}`,
        );
        const hit = data[0];
        if (!hit) return {};
        const ids = hit.movie?.ids ?? hit.show?.ids;
        if (!ids) return {};
        return {
          trakt: ids.trakt ? String(ids.trakt) : undefined,
          tmdb: ids.tmdb ? String(ids.tmdb) : undefined,
          tvdb: "tvdb" in ids && ids.tvdb ? String(ids.tvdb) : undefined,
          imdb: ids.imdb,
        };
      },
    },
  },

  jobs: {
    async refreshTokens(ctx) {
      // Host iterates per-connection; each call refreshes the passed credentials
      // and returns the new credential payload, which the host re-encrypts.
      const creds = ctx.credentials as TraktCreds | null;
      if (!creds) return null;
      const aboutToExpire = creds.createdAt + creds.expiresIn * 1000 - Date.now() < 60 * 60 * 1000;
      if (!aboutToExpire) return null;
      const global = ctx.config.global as TraktGlobalCfg | null;
      const clientId = global?.clientId;
      const clientSecret = global?.clientSecret;
      if (!clientId || !clientSecret) return null;
      const res = await ctx.fetch(`${BASE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refresh_token: creds.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
        }),
      });
      if (!res.ok) throw pluginError("plugin.token_expired", `Trakt refresh ${res.status}`);
      const body = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        created_at: number;
        expires_in: number;
      };
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        createdAt: body.created_at * 1000,
        expiresIn: body.expires_in,
      };
    },
  },
});
