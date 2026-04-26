import { definePlugin } from "@ent-mcp/plugin-sdk";
import type { AuthResult, PluginContext } from "@ent-mcp/plugin-sdk";
import { isPluginError } from "@ent-mcp/plugin-sdk";
import { pluginError, toErrorMessage } from "@ent-mcp/plugin-sdk";
import { handleHttpStatus } from "@ent-mcp/plugin-sdk";

// Error codes the host layer reacts to (token refresh, backoff, credential
// reconfig). Plugin methods that otherwise absorb errors into a graceful
// { ok: false } contract must still let these escape so the host can act.
const HOST_ACTIONABLE_CODES = new Set([
  "plugin.token_expired",
  "plugin.bad_credentials",
  "plugin.rate_limited",
]);

function isHostActionable(err: unknown): boolean {
  return isPluginError(err) && HOST_ACTIONABLE_CODES.has(err.code);
}

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

// DELETE helper that does NOT throw on 404 — callers that treat 404 as
// idempotent success (e.g. cancelRequest) need to inspect the status themselves.
// 401 still translates to plugin.token_expired so auth refresh triggers.
async function seerrDeleteRaw(ctx: Ctx, path: string): Promise<Response> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    method: "DELETE",
    headers: { Cookie: getSessionCookie(ctx) },
  });
  if (res.status === 401) {
    throw pluginError("plugin.token_expired", "Seerr auth rejected (401)");
  }
  if (res.status === 429) {
    throw pluginError("plugin.rate_limited", "Seerr rate limited (429)");
  }
  if (res.status >= 500) {
    throw pluginError("plugin.upstream_error", `Seerr server error (${res.status})`);
  }
  return res;
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

interface SeerrRequestRow {
  id: number;
  type: "movie" | "tv";
  status: number;
  createdAt: string;
  media: { tmdbId: number; title?: string; originalTitle?: string; posterPath?: string };
}

/**
 * Fetches every request page from Seerr. Shared between the `listRequests`
 * capability and the per-connection sync job.
 */
async function fetchAllRequests(ctx: Ctx): Promise<SeerrRequestRow[]> {
  const PAGE_SIZE = 100;
  const all: SeerrRequestRow[] = [];
  let skip = 0;
  while (true) {
    const data = await seerrGet<{ results: SeerrRequestRow[] }>(
      ctx,
      `/request?take=${PAGE_SIZE}&skip=${skip}`,
    );
    all.push(...data.results);
    if (data.results.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }
  return all;
}

const REQUEST_STATUS_STORE_KEY = "seerr.requestStatuses.v1";

/**
 * Per-connection job that detects request-status transitions in Seerr and
 * emits `media.request.available` / `media.request.denied` events.
 *
 * State is kept in `ctx.store` keyed per connection (the host scopes the
 * store by user automatically). On the first run for a connection no events
 * fire — the job simply records the baseline. Subsequent runs emit when a
 * request transitions into the `available` or `failed` terminal states.
 *
 * Emits run via `ctx.notify` so the host's `emit()` handles enrichment,
 * permission gating, and delivery scheduling. Emit failures are logged by
 * the host wrapper and do not break the sweep.
 */
async function syncRequestStatuses(ctx: Ctx): Promise<void> {
  if (!ctx.userId) return;

  const prior = ((await ctx.store.get(REQUEST_STATUS_STORE_KEY, { scope: "user" })) ??
    {}) as Record<string, string>;
  const requests = await fetchAllRequests(ctx);
  const next: Record<string, string> = {};
  const isFirstRun = Object.keys(prior).length === 0;

  for (const row of requests) {
    const id = String(row.id);
    const status = mapRequestStatus(row.status);
    next[id] = status;

    if (isFirstRun) continue;
    if (prior[id] === status) continue;

    const title = row.media.title ?? row.media.originalTitle ?? "";
    const mediaId = String(row.media.tmdbId);
    const posterUrl = row.media.posterPath
      ? `https://image.tmdb.org/t/p/w500${row.media.posterPath}`
      : undefined;

    if (status === "available") {
      await ctx.notify({
        type: "media.request.available",
        category: "media",
        severity: "info",
        audience: { kind: "user", userId: ctx.userId },
        payload: { requestId: id, mediaId, title, ...(posterUrl ? { posterUrl } : {}) },
      });
    } else if (status === "failed") {
      await ctx.notify({
        type: "media.request.denied",
        category: "media",
        severity: "warn",
        audience: { kind: "user", userId: ctx.userId },
        payload: { requestId: id, mediaId, title, ...(posterUrl ? { posterUrl } : {}) },
      });
    }
  }

  await ctx.store.set(REQUEST_STATUS_STORE_KEY, next, { scope: "user" });
}

export default definePlugin({
  manifest: {
    id: "seerr",
    name: "Seerr",
    version: "1.3.0",
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
    jobs: [
      {
        id: "requestStatusSync",
        // Every 5 minutes; matches the polling cadence the design assumes for
        // request status notifications.
        schedule: "*/5 * * * *",
        handler: "syncRequestStatuses",
        perConnection: true,
      },
    ],
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
          // Token expiry and rate limits must escape so the host can refresh
          // credentials or back off — swallowing them strands the session.
          if (isHostActionable(err)) throw err;
          if (isPluginError(err)) return { success: false, message: err.message };
          return { success: false, message: String(err) };
        }
      },

      async cancelRequest(ctx, input) {
        const { requestId } = input as { requestId: string };
        try {
          // Use seerrDeleteRaw so 404 is not converted into a thrown error —
          // Seerr returns 204 on success and 404 when the row has already
          // been removed. Both are idempotent success from the caller's
          // perspective. 401/429/5xx still throw via the helper.
          const res = await seerrDeleteRaw(ctx as Ctx, `/request/${requestId}`);
          if (res.ok || res.status === 404) return { ok: true };
          return { ok: false, message: `Seerr ${res.status}` };
        } catch (err) {
          if (isHostActionable(err)) throw err;
          if (isPluginError(err)) return { ok: false, message: err.message };
          return { ok: false, message: String(err) };
        }
      },

      async listRequests(ctx, _input) {
        const all = await fetchAllRequests(ctx as Ctx);
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
  jobs: {
    syncRequestStatuses: (ctx) => syncRequestStatuses(ctx as Ctx),
  },
});
