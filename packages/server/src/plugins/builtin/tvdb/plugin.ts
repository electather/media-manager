import { definePlugin } from "../../../plugin-runtime/define";
import type { PluginContext } from "../../../plugin-runtime/types";
import { pluginError, toErrorMessage } from "../../utils/plugin-error";
import { handleHttpStatus } from "../../utils/http-status";

interface TvdbSharedCreds {
  apiKey?: string;
}
interface TvdbUserCreds {}
interface TvdbUserCfg {}
interface TvdbGlobalCfg {}

type Ctx = PluginContext<TvdbUserCreds, TvdbSharedCreds, TvdbUserCfg, TvdbGlobalCfg>;

const BASE = "https://api4.thetvdb.com/v4";
const TOKEN_KEY = "jwt";
const TOKEN_TTL_SEC = 60 * 60 * 23; // TVDB tokens live ~24h, refresh slightly early.

function resolveKey(ctx: Ctx): string {
  const value = ctx.sharedCredentials?.apiKey;
  if (!value) throw pluginError("plugin.bad_credentials", "TVDB api key not configured");
  return value;
}

async function getToken(ctx: Ctx): Promise<string> {
  const cached = (await ctx.store.get(TOKEN_KEY, { scope: "global" })) as string | undefined;
  if (cached) return cached;
  const res = await ctx.fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apikey: resolveKey(ctx) }),
  });
  if (!res.ok) throw pluginError("plugin.bad_credentials", `TVDB login ${res.status}`);
  const body = (await res.json()) as { data?: { token?: string } };
  const token = body.data?.token;
  if (!token) throw pluginError("plugin.bad_credentials", "TVDB login returned no token");
  await ctx.store.set(TOKEN_KEY, token, { scope: "global", ttlSec: TOKEN_TTL_SEC });
  return token;
}

async function tvdbGet(ctx: Ctx, path: string): Promise<unknown> {
  const token = await getToken(ctx);
  const res = await ctx.fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    // Token may have been invalidated early; drop cache and retry once.
    await ctx.store.delete(TOKEN_KEY, { scope: "global" });
    const retryToken = await getToken(ctx);
    const retry = await ctx.fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${retryToken}` },
    });
    if (retry.status === 429) {
      const retryAfterSec = Number(retry.headers.get("Retry-After") ?? 0) || undefined;
      ctx.pool.markExhausted({ retryAfterSec });
      throw pluginError("plugin.rate_limited", "TVDB rate-limited (429)");
    }
    handleHttpStatus(retry, "TVDB");
    if (!retry.ok) throw pluginError("plugin.upstream_error", `TVDB ${retry.status}`);
    return retry.json();
  }
  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get("Retry-After") ?? 0) || undefined;
    ctx.pool.markExhausted({ retryAfterSec });
    throw pluginError("plugin.rate_limited", "TVDB rate-limited (429)");
  }
  handleHttpStatus(res, "TVDB");
  if (!res.ok) throw pluginError("plugin.upstream_error", `TVDB ${res.status}`);
  return res.json();
}

export default definePlugin({
  manifest: {
    id: "tvdb",
    name: "TheTVDB",
    version: "2.0.0",
    description: "Cross-service id resolution via TheTVDB. Admin-configured API key pool.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api4.thetvdb.com"],
    sharedCredentialsSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "TVDB API key (v4)",
          "x-secret": true,
        },
      },
      required: ["apiKey"],
    },
    auth: { kind: "none" },
    capabilities: {
      idResolve: { version: "v1", scope: "global" },
    },
    poolable: true,
  },

  async verifyShared(ctx) {
    try {
      await getToken(ctx as Ctx);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

  capabilities: {
    idResolve: {
      async resolve(ctx, input) {
        const { from, id, type } = input as {
          from: "tmdb" | "tvdb" | "trakt" | "imdb";
          id: string;
          type: "movie" | "tv";
        };
        if (from === "tvdb") return { tvdb: id };

        // TVDB's /search/remoteid/{id} returns matches across all known source types.
        const source = from === "tmdb" ? "tmdb" : from === "imdb" ? "imdb" : null;
        if (!source) return {};
        const data = (await tvdbGet(ctx as Ctx, `/search/remoteid/${id}`)) as {
          data?: Array<{
            movie?: { id: number };
            series?: { id: number };
          }>;
        };
        const hit = (data.data ?? []).find((row) => (type === "movie" ? row.movie : row.series));
        const tvdbId = type === "movie" ? hit?.movie?.id : hit?.series?.id;
        return tvdbId ? { tvdb: String(tvdbId) } : {};
      },
    },
  },
});
