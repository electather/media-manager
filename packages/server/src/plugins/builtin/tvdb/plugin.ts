import { definePlugin } from "../../../plugin-runtime/define";
import { PluginError } from "../../../plugin-runtime/types";
import type { PluginContext } from "../../../plugin-runtime/types";

interface TvdbCreds {
  apiKey?: string;
}
interface TvdbUserCfg {}
interface TvdbGlobalCfg {
  apiKey?: string;
}

type Ctx = PluginContext<TvdbCreds, TvdbUserCfg, TvdbGlobalCfg>;

const BASE = "https://api4.thetvdb.com/v4";
const TOKEN_KEY = "jwt";
const TOKEN_TTL_SEC = 60 * 60 * 23; // TVDB tokens live ~24h, refresh slightly early.

function resolveKey(ctx: Ctx): string {
  const key = ctx.credentials?.apiKey || ctx.config.global?.apiKey;
  if (!key) throw new PluginError("AUTH_INVALID", "no TVDB api key available (user or global)");
  return key;
}

async function getToken(ctx: Ctx): Promise<string> {
  const cached = (await ctx.store.get(TOKEN_KEY, { scope: "global" })) as string | undefined;
  if (cached) return cached;
  const res = await ctx.fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apikey: resolveKey(ctx) }),
  });
  if (!res.ok) throw new PluginError("AUTH_INVALID", `TVDB login ${res.status}`);
  const body = (await res.json()) as { data?: { token?: string } };
  const token = body.data?.token;
  if (!token) throw new PluginError("AUTH_INVALID", "TVDB login returned no token");
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
    if (!retry.ok) throw new PluginError("UPSTREAM_ERROR", `TVDB ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new PluginError("UPSTREAM_ERROR", `TVDB ${res.status}`);
  return res.json();
}

export default definePlugin({
  manifest: {
    id: "tvdb",
    name: "TheTVDB",
    version: "1.0.1",
    description: "Supplemental TV metadata and cross-service ID resolution via TheTVDB.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api4.thetvdb.com"],
    globalConfigSchema: {
      type: "object",
      properties: {
        apiKey: { type: "string", title: "TVDB API key (v4)" },
      },
      required: ["apiKey"],
    },
    userConfigSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "Your personal TVDB API key (v4)",
          "x-secret": true,
        },
      },
      required: ["apiKey"],
      additionalProperties: false,
    },
    credentialsSchema: {
      type: "object",
      properties: {
        apiKey: { type: "string" },
      },
      required: ["apiKey"],
    },
    auth: { kind: "form" },
    capabilities: {
      idResolve: "v1",
    },
  },

  async startAuth(ctx, input) {
    const parsed = input as { apiKey?: string } | null;
    if (!parsed?.apiKey) {
      return { status: "error", code: "AUTH_INVALID", message: "apiKey required" };
    }
    const res = await ctx.fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apikey: parsed.apiKey }),
    });
    if (!res.ok) return { status: "error", code: "AUTH_INVALID", message: `TVDB ${res.status}` };
    return { status: "completed", credentials: { apiKey: parsed.apiKey } };
  },

  async testConnection(ctx) {
    try {
      await getToken(ctx as Ctx);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
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
