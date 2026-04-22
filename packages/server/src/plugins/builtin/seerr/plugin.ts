import { definePlugin } from "../../../plugin-runtime/define";
import type { AuthResult, PluginContext } from "../../../plugin-runtime/types";
import { isPluginError } from "../../../plugin-runtime/types";
import { pluginError, toErrorMessage } from "../../utils/plugin-error";
import { handleHttpStatus } from "../../utils/http-status";

interface SeerrCreds {
  sessionCookie: string;
  userId: number;
}

interface SeerrSharedCreds {}

interface SeerrUserCfg {
  username: string;
  password: string;
}

interface SeerrGlobalCfg {
  baseUrl: string;
}

type Ctx = PluginContext<SeerrCreds, SeerrSharedCreds, SeerrUserCfg, SeerrGlobalCfg>;

const SESSION_COOKIE_NAME = "connect.sid";

function getBaseUrl(ctx: Ctx): string {
  const url = ctx.config.global?.baseUrl;
  if (!url) throw pluginError("plugin.bad_credentials", "Seerr baseUrl not configured by admin");
  return url.replace(/\/$/, "");
}

function getSessionCookie(ctx: Ctx): string {
  const cookie = ctx.credentials?.sessionCookie;
  if (!cookie)
    throw pluginError("plugin.token_expired", "Seerr session missing — please reconnect");
  return cookie;
}

// Extracts the `connect.sid=<value>` pair from the Set-Cookie headers returned
// by Seerr's auth endpoint. Seerr sessions are opaque to the host; we store
// the pair verbatim and replay it on every request.
function extractSessionCookie(res: Response): string | null {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : null;
  const candidates =
    list ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  for (const raw of candidates) {
    for (const part of raw.split(/,(?=\s*[^;,\s]+=)/)) {
      const trimmed = part.trim();
      if (trimmed.toLowerCase().startsWith(`${SESSION_COOKIE_NAME.toLowerCase()}=`)) {
        const end = trimmed.indexOf(";");
        return end === -1 ? trimmed : trimmed.slice(0, end);
      }
    }
  }
  return null;
}

function handleStatus(res: Response): void {
  handleHttpStatus(res, "Seerr", { on401: "plugin.token_expired" });
}

async function seerrGet<T>(ctx: Ctx, path: string): Promise<T> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    headers: { Cookie: getSessionCookie(ctx) },
  });
  handleStatus(res);
  if (!res.ok)
    throw pluginError("plugin.upstream_error", `Seerr ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function seerrPost<T>(ctx: Ctx, path: string, body: unknown): Promise<T> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: getSessionCookie(ctx),
    },
    body: JSON.stringify(body),
  });
  handleStatus(res);
  if (!res.ok)
    throw pluginError("plugin.upstream_error", `Seerr ${res.status}: ${await res.text()}`);
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
    version: "1.2.0",
    description:
      "Media request management via Seerr. Admins set the server URL; users sign in with their Seerr email and password and the plugin keeps a session cookie per user.",
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
        sessionCookie: { type: "string" },
        userId: { type: "number" },
      },
      required: ["sessionCookie", "userId"],
    },
    auth: { kind: "form" },
    capabilities: {
      mediaRequest: { version: "v1", scope: "user" },
    },
    poolable: false,
  },

  async startAuth(ctx, input): Promise<AuthResult> {
    const cfg = input as SeerrUserCfg | null;
    const base = (ctx.config.global as SeerrGlobalCfg | null)?.baseUrl;
    if (!base) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "Seerr baseUrl not configured by admin",
      };
    }
    const trimmed = base.replace(/\/$/, "");

    const email = cfg?.username;
    const password = cfg?.password;
    if (!email || !password) {
      return {
        status: "error",
        code: "plugin.input_invalid",
        devMessage: "username and password are required",
      };
    }

    const authRes = await ctx.fetch(`${trimmed}/api/v1/auth/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (authRes.status === 401 || authRes.status === 403) {
      return {
        status: "error",
        code: "plugin.bad_credentials",
        devMessage: "invalid email or password",
      };
    }
    if (!authRes.ok) {
      return {
        status: "error",
        code: "plugin.upstream_error",
        devMessage: `Seerr auth failed with status ${authRes.status}`,
      };
    }

    const sessionCookie = extractSessionCookie(authRes);
    if (!sessionCookie) {
      return {
        status: "error",
        code: "plugin.upstream_error",
        devMessage: "Seerr did not return a session cookie",
      };
    }

    const user = (await authRes.json()) as { id: number };

    return {
      status: "completed",
      credentials: {
        sessionCookie,
        userId: user.id,
      },
    };
  },

  async testConnection(ctx) {
    try {
      const res = await ctx.fetch(`${getBaseUrl(ctx as Ctx)}/api/v1/auth/me`, {
        headers: { Cookie: getSessionCookie(ctx as Ctx) },
      });
      if (res.status === 401) return { ok: false, message: "session invalid or expired" };
      if (!res.ok) return { ok: false, message: `Seerr ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
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
          if (
            isPluginError(err) &&
            (err.code === "internal" ||
              err.code === "transient_network" ||
              err.code === "not_found")
          ) {
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
          if (isPluginError(err)) return { success: false, message: err.message };
          return { success: false, message: String(err) };
        }
      },

      async listRequests(ctx, _input) {
        type RequestItem = {
          id: number;
          type: "movie" | "tv";
          status: number;
          createdAt: string;
          media: { tmdbId: number; title?: string; originalTitle?: string };
        };
        const PAGE_SIZE = 100;
        const all: RequestItem[] = [];
        let skip = 0;
        while (true) {
          const data = await seerrGet<{ results: RequestItem[] }>(
            ctx as Ctx,
            `/request?take=${PAGE_SIZE}&skip=${skip}`,
          );
          all.push(...data.results);
          if (data.results.length < PAGE_SIZE) break;
          skip += PAGE_SIZE;
        }
        return all.map((r) => ({
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
