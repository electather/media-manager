import { definePlugin } from "../../../plugin-runtime/define";
import { PluginError } from "../../../plugin-runtime/types";
import type { AuthResult, PluginContext } from "../../../plugin-runtime/types";

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
  if (!clientId) throw new PluginError("AUTH_INVALID", "Trakt clientId missing from global config");
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
  if (res.status === 401) throw new PluginError("AUTH_EXPIRED", "Trakt token expired or invalid");
  if (!res.ok) throw new PluginError("UPSTREAM_ERROR", `Trakt ${res.status}: ${await res.text()}`);
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
    externalIds: {
      trakt: String(m.ids.trakt),
      tmdb: m.ids.tmdb ? String(m.ids.tmdb) : undefined,
      imdb: m.ids.imdb,
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
    externalIds: {
      trakt: String(s.ids.trakt),
      tmdb: s.ids.tmdb ? String(s.ids.tmdb) : undefined,
      tvdb: s.ids.tvdb ? String(s.ids.tvdb) : undefined,
      imdb: s.ids.imdb,
    },
  };
}

export default definePlugin({
  manifest: {
    id: "trakt",
    name: "Trakt",
    version: "1.0.0",
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
      return { status: "error", code: "AUTH_INVALID", message: "Trakt clientId not configured" };
    }
    const res = await ctx.fetch(`${BASE}/oauth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    });
    if (!res.ok) {
      return { status: "error", code: "UPSTREAM_ERROR", message: `Trakt ${res.status}` };
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
      return { status: "error", code: "AUTH_INVALID", message: "Trakt client not configured" };
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
      return { status: "error", code: "AUTH_EXPIRED", message: "device code expired or denied" };
    }
    if (!res.ok) return { status: "error", code: "UPSTREAM_ERROR", message: `Trakt ${res.status}` };
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
      throw new PluginError("AUTH_INVALID", "Trakt client not configured");
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
    if (!res.ok) throw new PluginError("AUTH_EXPIRED", `Trakt refresh ${res.status}`);
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
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
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
        const items = input as Array<{ type: "movie" | "tv"; externalIds: { trakt?: string } }>;
        const movies = items
          .filter((i) => i.type === "movie" && i.externalIds.trakt)
          .map((i) => ({ ids: { trakt: Number(i.externalIds.trakt) } }));
        const shows = items
          .filter((i) => i.type === "tv" && i.externalIds.trakt)
          .map((i) => ({ ids: { trakt: Number(i.externalIds.trakt) } }));
        const res = await traktFetch(ctx as Ctx, "/sync/history", {
          method: "POST",
          body: JSON.stringify({ movies, shows }),
        });
        if (!res.ok) throw new PluginError("UPSTREAM_ERROR", `Trakt ${res.status}`);
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
        const items = input as Array<{ type: "movie" | "tv"; externalIds: { trakt?: string } }>;
        const movies = items
          .filter((i) => i.type === "movie" && i.externalIds.trakt)
          .map((i) => ({ ids: { trakt: Number(i.externalIds.trakt) } }));
        const shows = items
          .filter((i) => i.type === "tv" && i.externalIds.trakt)
          .map((i) => ({ ids: { trakt: Number(i.externalIds.trakt) } }));
        const res = await traktFetch(ctx as Ctx, "/sync/watchlist", {
          method: "POST",
          body: JSON.stringify({ movies, shows }),
        });
        if (!res.ok) throw new PluginError("UPSTREAM_ERROR", `Trakt ${res.status}`);
        const body = (await res.json()) as { added?: { movies?: number; shows?: number } };
        return { added: (body.added?.movies ?? 0) + (body.added?.shows ?? 0) };
      },

      async removeFromWatchlist(ctx, input) {
        const items = input as Array<{ type: "movie" | "tv"; externalIds: { trakt?: string } }>;
        const movies = items
          .filter((i) => i.type === "movie" && i.externalIds.trakt)
          .map((i) => ({ ids: { trakt: Number(i.externalIds.trakt) } }));
        const shows = items
          .filter((i) => i.type === "tv" && i.externalIds.trakt)
          .map((i) => ({ ids: { trakt: Number(i.externalIds.trakt) } }));
        const res = await traktFetch(ctx as Ctx, "/sync/watchlist/remove", {
          method: "POST",
          body: JSON.stringify({ movies, shows }),
        });
        if (!res.ok) throw new PluginError("UPSTREAM_ERROR", `Trakt ${res.status}`);
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
          item: { type: "movie" | "tv"; externalIds: { trakt?: string } };
          rating: number;
        };
        if (!item.externalIds.trakt) {
          throw new PluginError("INVALID_INPUT", "item.externalIds.trakt required");
        }
        const body =
          item.type === "movie"
            ? { movies: [{ rating, ids: { trakt: Number(item.externalIds.trakt) } }] }
            : { shows: [{ rating, ids: { trakt: Number(item.externalIds.trakt) } }] };
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
      // Host iterates per-connection; each call should refresh the passed credentials
      // and return the new credential payload, which the host re-encrypts.
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
      if (!res.ok) throw new PluginError("AUTH_EXPIRED", `Trakt refresh ${res.status}`);
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
