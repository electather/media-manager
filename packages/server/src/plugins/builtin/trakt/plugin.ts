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
interface TraktSharedCreds {
  clientId: string;
  clientSecret: string;
}
interface TraktUserCfg {}
interface TraktGlobalCfg {}

type Ctx = PluginContext<TraktCreds, TraktSharedCreds, TraktUserCfg, TraktGlobalCfg>;

const BASE = "https://api.trakt.tv";

function traktHeaders(ctx: Ctx): Record<string, string> {
  const clientId = ctx.sharedCredentials?.clientId;
  if (!clientId) {
    throw pluginError("plugin.bad_credentials", "Trakt clientId not configured by admin");
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

// Identical body to traktJson today, but kept as a separate symbol so the
// call sites read as "this endpoint mutates state, expect a JSON summary
// back" — useful when scanning the plugin for surfaces that need the write
// discipline (401 → token_expired, 429 → rate_limited, non-2xx → upstream).
// Merging the two would obscure that intent and make future write-only
// changes (e.g. structured audit hooks) harder to apply in one place.
async function traktJsonWrite<T>(ctx: Ctx, path: string, init: RequestInit = {}): Promise<T> {
  const res = await traktFetch(ctx, path, init);
  handleHttpStatus(res, "Trakt", { on401: "plugin.token_expired" });
  if (!res.ok)
    throw pluginError("plugin.upstream_error", `Trakt ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// Parses a Trakt numeric id from its stringified form. Returns `null` when the
// value is missing or not an integer so callers can filter it out before
// sending a payload — Trakt rejects `{ trakt: null }` and `Number("abc")`
// produces NaN, which serialises to `null` in JSON.
function parseTraktId(id: string | undefined): number | null {
  if (!id) return null;
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

interface TraktMediaItemRef {
  type: "movie" | "tv";
  ids?: { trakt_id?: string };
}

// Splits a mixed movie/tv array into the Trakt request-body shape. Items with
// missing or non-numeric trakt ids are dropped — Trakt payloads with null ids
// produce 4xx errors.
function splitByType(items: TraktMediaItemRef[]): {
  movies: Array<{ ids: { trakt: number } }>;
  shows: Array<{ ids: { trakt: number } }>;
} {
  const movies: Array<{ ids: { trakt: number } }> = [];
  const shows: Array<{ ids: { trakt: number } }> = [];
  for (const i of items) {
    const n = parseTraktId(i.ids?.trakt_id);
    if (n === null) continue;
    if (i.type === "movie") movies.push({ ids: { trakt: n } });
    else if (i.type === "tv") shows.push({ ids: { trakt: n } });
  }
  return { movies, shows };
}

// Fetches every page of a paginated Trakt endpoint and returns all items.
// Uses X-Pagination-Page-Count from the first response to determine how many
// additional pages exist, then fetches them concurrently.
async function traktPaginate<T>(ctx: Ctx, basePath: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const sep = basePath.includes("?") ? "&" : "?";
  const firstRes = await traktFetch(ctx, `${basePath}${sep}page=1&limit=${PAGE_SIZE}`);
  handleHttpStatus(firstRes, "Trakt", { on401: "plugin.token_expired" });
  if (!firstRes.ok)
    throw pluginError(
      "plugin.upstream_error",
      `Trakt ${firstRes.status}: ${await firstRes.text()}`,
    );
  const pageCount = Number(firstRes.headers.get("X-Pagination-Page-Count") ?? "1");
  const firstPage = (await firstRes.json()) as T[];
  if (pageCount <= 1) return firstPage;
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, i) =>
      traktJson<T[]>(ctx, `${basePath}${sep}page=${i + 2}&limit=${PAGE_SIZE}`),
    ),
  );
  return ([] as T[]).concat(firstPage, ...rest);
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

export default definePlugin({
  manifest: {
    id: "trakt",
    name: "Trakt",
    version: "1.2.0",
    description: "Watch history, watchlist, ratings, recommendations, and calendar via Trakt.tv.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api.trakt.tv"],
    sharedCredentialsSchema: {
      type: "object",
      properties: {
        clientId: { type: "string", title: "Trakt client id", "x-secret": true },
        clientSecret: { type: "string", title: "Trakt client secret", "x-secret": true },
      },
      required: ["clientId", "clientSecret"],
    },
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
      watchHistory: { version: "v1", scope: "user" },
      watchlist: { version: "v1", scope: "user" },
      ratings: { version: "v1", scope: "user" },
      recommendations: { version: "v1", scope: "user" },
      calendar: { version: "v1", scope: "user" },
      idResolve: { version: "v1", scope: "global" },
      userComments: { version: "v1", scope: "user" },
      playback: { version: "v1", scope: "user" },
      collection: { version: "v1", scope: "user" },
    },
    poolable: false,
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
    const shared = ctx.sharedCredentials as TraktSharedCreds | null;
    const clientId = shared?.clientId;
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
    const shared = ctx.sharedCredentials as TraktSharedCreds | null;
    const clientId = shared?.clientId;
    const clientSecret = shared?.clientSecret;
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
    const shared = ctx.sharedCredentials as TraktSharedCreds | null;
    const clientId = shared?.clientId;
    const clientSecret = shared?.clientSecret;
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
        const { since } = input as { since?: string };
        const params = new URLSearchParams();
        if (since) params.set("start_at", since);
        const query = params.toString();
        const path = query ? `/sync/history?${query}` : "/sync/history";
        const data = await traktPaginate<{
          id: number;
          watched_at: string;
          type: "movie" | "episode";
          movie?: TraktMovie;
          show?: TraktShow;
        }>(ctx as Ctx, path);
        return data.map((row) => ({
          item: row.type === "movie" && row.movie ? mapMovie(row.movie) : mapShow(row.show!),
          watchedAt: row.watched_at,
          progress: 100,
        }));
      },

      async addToHistory(ctx, input) {
        const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
        const body = await traktJsonWrite<{ added?: { movies?: number; episodes?: number } }>(
          ctx as Ctx,
          "/sync/history",
          { method: "POST", body: JSON.stringify({ movies, shows }) },
        );
        return { added: (body.added?.movies ?? 0) + (body.added?.episodes ?? 0) };
      },

      async removeFromHistory(ctx, input) {
        const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
        const body = await traktJsonWrite<{ deleted?: { movies?: number; episodes?: number } }>(
          ctx as Ctx,
          "/sync/history/remove",
          { method: "POST", body: JSON.stringify({ movies, shows }) },
        );
        return { removed: (body.deleted?.movies ?? 0) + (body.deleted?.episodes ?? 0) };
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
        const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
        const body = await traktJsonWrite<{ added?: { movies?: number; shows?: number } }>(
          ctx as Ctx,
          "/sync/watchlist",
          { method: "POST", body: JSON.stringify({ movies, shows }) },
        );
        return { added: (body.added?.movies ?? 0) + (body.added?.shows ?? 0) };
      },

      async removeFromWatchlist(ctx, input) {
        const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
        const body = await traktJsonWrite<{ deleted?: { movies?: number; shows?: number } }>(
          ctx as Ctx,
          "/sync/watchlist/remove",
          { method: "POST", body: JSON.stringify({ movies, shows }) },
        );
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
          item: TraktMediaItemRef;
          rating: number;
        };
        const traktId = parseTraktId(item.ids?.trakt_id);
        if (traktId === null) {
          throw pluginError("plugin.input_invalid", "item.ids.trakt_id required (numeric)");
        }
        const body =
          item.type === "movie"
            ? { movies: [{ rating, ids: { trakt: traktId } }] }
            : { shows: [{ rating, ids: { trakt: traktId } }] };
        await traktJsonWrite(ctx as Ctx, "/sync/ratings", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { ok: true };
      },

      async removeRating(ctx, input) {
        const { item } = input as { item: TraktMediaItemRef };
        const traktId = parseTraktId(item.ids?.trakt_id);
        if (traktId === null) {
          throw pluginError("plugin.input_invalid", "item.ids.trakt_id required (numeric)");
        }
        const body =
          item.type === "movie"
            ? { movies: [{ ids: { trakt: traktId } }] }
            : { shows: [{ ids: { trakt: traktId } }] };
        await traktJsonWrite(ctx as Ctx, "/sync/ratings/remove", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { ok: true };
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

      async getTrending(ctx, input) {
        const { type = "movie", limit = 20 } = input as {
          type?: "movie" | "tv";
          limit?: number;
        };
        const path = type === "movie" ? "/movies/trending" : "/shows/trending";
        const data = await traktJson<
          Array<{ watchers: number; movie?: TraktMovie; show?: TraktShow }>
        >(ctx as Ctx, `${path}?limit=${limit}`);
        return data.map((row) => (type === "movie" ? mapMovie(row.movie!) : mapShow(row.show!)));
      },

      async getAnticipated(ctx, input) {
        const { type = "movie", limit = 20 } = input as {
          type?: "movie" | "tv";
          limit?: number;
        };
        const path = type === "movie" ? "/movies/anticipated" : "/shows/anticipated";
        const data = await traktJson<
          Array<{ list_count: number; movie?: TraktMovie; show?: TraktShow }>
        >(ctx as Ctx, `${path}?limit=${limit}`);
        // Trakt sometimes returns rows missing the expected nested object;
        // skip them rather than throw on a non-null assertion.
        const results = [];
        for (const row of data) {
          if (type === "movie" && row.movie) results.push(mapMovie(row.movie));
          else if (type === "tv" && row.show) results.push(mapShow(row.show));
        }
        return results;
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

      async getUpcomingMovies(ctx, input) {
        const { days = 30 } = input as { days?: number };
        const start = new Date().toISOString().slice(0, 10);
        const data = await traktJson<Array<{ released: string; movie: TraktMovie }>>(
          ctx as Ctx,
          `/calendars/my/movies/${start}/${days}`,
        );
        return data.map((row) => ({
          item: mapMovie(row.movie),
          airsAt: row.released,
        }));
      },
    },

    playback: {
      async getPositions(ctx, input) {
        const { type } = input as { type?: "movie" | "tv" };
        const path =
          type === "movie"
            ? "/sync/playback/movies"
            : type === "tv"
              ? "/sync/playback/episodes"
              : "/sync/playback";
        const data = await traktJson<
          Array<{
            id: number;
            progress: number;
            paused_at: string;
            type: "movie" | "episode";
            movie?: TraktMovie;
            show?: TraktShow;
            episode?: { season: number; number: number };
          }>
        >(ctx as Ctx, path);
        return data.map((row) => ({
          item: row.type === "movie" && row.movie ? mapMovie(row.movie) : mapShow(row.show!),
          progress: row.progress,
          pausedAt: row.paused_at,
          season: row.episode?.season,
          episode: row.episode?.number,
          playbackId: String(row.id),
        }));
      },

      async removePosition(ctx, input) {
        const { playbackId } = input as { playbackId: string };
        const res = await traktFetch(ctx as Ctx, `/sync/playback/${playbackId}`, {
          method: "DELETE",
        });
        // This endpoint can't route through traktJsonWrite because
        // handleHttpStatus turns 404 into a thrown error, but Trakt returns
        // 404 when the playback row is already cleared — callers should see
        // that as idempotent success. Translate 401/429/5xx explicitly so the
        // host still gets the signals it needs (token refresh, backoff),
        // while 204 and 404 both map to { ok: true }.
        if (res.status === 401)
          throw pluginError("plugin.token_expired", "Trakt auth rejected (401)");
        if (res.status === 429)
          throw pluginError("plugin.rate_limited", "Trakt rate limited (429)");
        if (res.status >= 500)
          throw pluginError("plugin.upstream_error", `Trakt server error (${res.status})`);
        return { ok: res.ok || res.status === 404 };
      },
    },

    collection: {
      async getCollection(ctx, input) {
        const { type } = input as { type?: "movie" | "tv" };
        if (type === "movie") {
          const data = await traktJson<Array<{ collected_at: string; movie: TraktMovie }>>(
            ctx as Ctx,
            "/sync/collection/movies",
          );
          return data.map((row) => ({ item: mapMovie(row.movie), addedAt: row.collected_at }));
        }
        if (type === "tv") {
          const data = await traktJson<Array<{ last_collected_at: string; show: TraktShow }>>(
            ctx as Ctx,
            "/sync/collection/shows",
          );
          return data.map((row) => ({ item: mapShow(row.show), addedAt: row.last_collected_at }));
        }
        // No type filter — fetch both and merge.
        const [movies, shows] = await Promise.all([
          traktJson<Array<{ collected_at: string; movie: TraktMovie }>>(
            ctx as Ctx,
            "/sync/collection/movies",
          ),
          traktJson<Array<{ last_collected_at: string; show: TraktShow }>>(
            ctx as Ctx,
            "/sync/collection/shows",
          ),
        ]);
        return [
          ...movies.map((row) => ({ item: mapMovie(row.movie), addedAt: row.collected_at })),
          ...shows.map((row) => ({ item: mapShow(row.show), addedAt: row.last_collected_at })),
        ];
      },

      async addToCollection(ctx, input) {
        const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
        const body = await traktJsonWrite<{ added?: { movies?: number; episodes?: number } }>(
          ctx as Ctx,
          "/sync/collection",
          { method: "POST", body: JSON.stringify({ movies, shows }) },
        );
        return { added: (body.added?.movies ?? 0) + (body.added?.episodes ?? 0) };
      },

      async removeFromCollection(ctx, input) {
        const { movies, shows } = splitByType(input as TraktMediaItemRef[]);
        const body = await traktJsonWrite<{ deleted?: { movies?: number; episodes?: number } }>(
          ctx as Ctx,
          "/sync/collection/remove",
          { method: "POST", body: JSON.stringify({ movies, shows }) },
        );
        return { removed: (body.deleted?.movies ?? 0) + (body.deleted?.episodes ?? 0) };
      },
    },

    userComments: {
      async getComments(ctx, _input) {
        const data = await traktPaginate<{
          type: "movie" | "show";
          comment: { text: string; created_at: string };
          movie?: TraktMovie;
          show?: TraktShow;
        }>(ctx as Ctx, "/users/me/comments");
        return data
          .filter((row) => row.movie ?? row.show)
          .map((row) => ({
            item: row.movie ? mapMovie(row.movie) : mapShow(row.show!),
            text: row.comment.text,
            createdAt: row.comment.created_at,
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
          tvdb: "tvdb" in ids && ids.tvdb ? String(ids.tvdb as number) : undefined,
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
      const shared = ctx.sharedCredentials as TraktSharedCreds | null;
      const clientId = shared?.clientId;
      const clientSecret = shared?.clientSecret;
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
