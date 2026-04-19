import { definePlugin } from "../../../plugin-runtime/define";
import { PluginError } from "../../../plugin-runtime/types";
import type { AuthResult, PluginContext } from "../../../plugin-runtime/types";

interface SeerrCreds {
  apiKey: string;
  userId: number;
}

interface SeerrUserCfg {
  username: string;
  password: string;
}

interface SeerrGlobalCfg {
  baseUrl: string;
}

type Ctx = PluginContext<SeerrCreds, SeerrUserCfg, SeerrGlobalCfg>;

function getBaseUrl(ctx: Ctx): string {
  const url = ctx.config.global?.baseUrl;
  if (!url) throw new PluginError("AUTH_INVALID", "Seerr baseUrl not configured by admin");
  return url.replace(/\/$/, "");
}

function getApiKey(ctx: Ctx): string {
  const key = ctx.credentials?.apiKey;
  if (!key) throw new PluginError("AUTH_EXPIRED", "Seerr API key missing — please reconnect");
  return key;
}

async function seerrGet<T>(ctx: Ctx, path: string): Promise<T> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    headers: { "X-Api-Key": getApiKey(ctx) },
  });
  if (res.status === 401) throw new PluginError("AUTH_EXPIRED", "Seerr API key invalid or expired");
  if (!res.ok) throw new PluginError("UPSTREAM_ERROR", `Seerr ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function seerrPost<T>(ctx: Ctx, path: string, body: unknown): Promise<T> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Api-Key": getApiKey(ctx),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new PluginError("AUTH_EXPIRED", "Seerr API key invalid or expired");
  if (!res.ok) throw new PluginError("UPSTREAM_ERROR", `Seerr ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Seerr media status: 1=unknown, 2=pending, 3=processing, 4=partial, 5=available.
function mapMediaStatus(
  status: number,
): "available" | "requested" | "processing" | "unavailable" | "unknown" {
  switch (status) {
    case 5:
      return "available";
    case 4:
      return "processing";
    case 3:
      return "processing";
    case 2:
      return "requested";
    case 1:
      return "unavailable";
    default:
      return "unknown";
  }
}

// Seerr request status: 1=pending, 2=approved, 3=declined, 4=available.
function mapRequestStatus(
  status: number,
): "pending" | "approved" | "processing" | "available" | "failed" {
  switch (status) {
    case 1:
      return "pending";
    case 2:
      return "approved";
    case 3:
      return "failed";
    case 4:
      return "available";
    default:
      return "pending";
  }
}

export default definePlugin({
  manifest: {
    id: "seerr",
    name: "Seerr",
    version: "1.0.0",
    description:
      "Media request management via Seerr. Admins set the server URL; users authenticate with their account credentials.",
    author: { name: "Media Manager", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    // Allow-all because the host is admin-configurable at runtime.
    allowedHosts: ["*"],
    globalConfigSchema: {
      type: "object",
      properties: {
        baseUrl: {
          type: "string",
          title: "Seerr URL",
          description: "Base URL of your Seerr instance (e.g. https://requests.example.com).",
        },
      },
      required: ["baseUrl"],
    },
    userConfigSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          title: "Email address",
        },
        password: {
          type: "string",
          title: "Password",
          "x-secret": true,
        },
      },
      required: ["username", "password"],
      additionalProperties: false,
    },
    credentialsSchema: {
      type: "object",
      properties: {
        apiKey: { type: "string" },
        userId: { type: "number" },
      },
      required: ["apiKey", "userId"],
    },
    auth: { kind: "form" },
    capabilities: {
      mediaRequest: "v1",
    },
  },

  async startAuth(ctx, input): Promise<AuthResult> {
    const cfg = input as SeerrUserCfg | null;
    const base = (ctx.config.global as SeerrGlobalCfg | null)?.baseUrl;
    if (!base) {
      return {
        status: "error",
        code: "AUTH_INVALID",
        message: "Seerr baseUrl not configured by admin",
      };
    }
    const trimmed = base.replace(/\/$/, "");

    const email = cfg?.username;
    const password = cfg?.password;
    if (!email || !password) {
      return {
        status: "error",
        code: "AUTH_INVALID",
        message: "username and password are required",
      };
    }

    const authRes = await ctx.fetch(`${trimmed}/api/v1/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (authRes.status === 401 || authRes.status === 403) {
      return { status: "error", code: "AUTH_INVALID", message: "invalid email or password" };
    }
    if (!authRes.ok) {
      return {
        status: "error",
        code: "UPSTREAM_ERROR",
        message: `Seerr auth failed with status ${authRes.status}`,
      };
    }

    // Both Seerr return the full user object from /auth/local.
    const user = (await authRes.json()) as {
      id: number;
      apiKey?: string;
      userApiKey?: string;
    };

    const resolvedApiKey = user.apiKey ?? user.userApiKey;
    if (!resolvedApiKey) {
      return {
        status: "error",
        code: "UPSTREAM_ERROR",
        message: "Seerr did not return an API key — ensure your account has API access enabled",
      };
    }

    return {
      status: "completed",
      credentials: {
        apiKey: resolvedApiKey,
        userId: user.id,
      },
    };
  },

  async testConnection(ctx) {
    try {
      const res = await ctx.fetch(`${getBaseUrl(ctx as Ctx)}/api/v1/auth/me`, {
        headers: { "X-Api-Key": getApiKey(ctx as Ctx) },
      });
      if (res.status === 401) return { ok: false, message: "API key invalid or expired" };
      if (!res.ok) return { ok: false, message: `Seerr ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  capabilities: {
    mediaRequest: {
      async checkAvailability(ctx, input) {
        const { tmdbId, type } = input as { tmdbId: string; type: "movie" | "tv" };
        const path = type === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
        try {
          const data = await seerrGet<{ mediaInfo?: { status: number } }>(ctx as Ctx, path);
          if (!data.mediaInfo) return { status: "unavailable" };
          return { status: mapMediaStatus(data.mediaInfo.status) };
        } catch (err) {
          if (err instanceof PluginError && err.code === "UPSTREAM_ERROR") {
            return { status: "unknown" };
          }
          throw err;
        }
      },

      async createRequest(ctx, input) {
        const { tmdbId, type, seasons } = input as {
          tmdbId: string;
          type: "movie" | "tv";
          seasons?: string;
        };
        const body: Record<string, unknown> = {
          mediaType: type,
          mediaId: Number(tmdbId),
        };
        if (type === "tv" && seasons) {
          body["seasons"] = seasons
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !Number.isNaN(n));
        }
        try {
          const data = await seerrPost<{ id: number }>(ctx as Ctx, "/request", body);
          return { success: true, requestId: String(data.id) };
        } catch (err) {
          if (err instanceof PluginError) return { success: false, message: err.message };
          return { success: false, message: String(err) };
        }
      },

      async listRequests(ctx, _input) {
        const data = await seerrGet<{
          results: Array<{
            id: number;
            type: "movie" | "tv";
            status: number;
            createdAt: string;
            media: { tmdbId: number; title?: string; originalTitle?: string };
          }>;
        }>(ctx as Ctx, "/request?take=100&skip=0");
        return data.results.map((r) => ({
          id: String(r.id),
          tmdbId: String(r.media.tmdbId),
          type: r.type,
          title: r.media.title ?? r.media.originalTitle ?? "",
          status: mapRequestStatus(r.status),
          createdAt: r.createdAt,
        }));
      },
    },
  },
});
