import { pluginError, toErrorMessage } from "@ent-mcp/plugin-sdk";
import type { AuthResult } from "@ent-mcp/plugin-sdk";
import { traktFetch } from "./client";
import { BASE } from "./constants";
import type { Ctx, TraktCreds, TraktSharedCreds } from "./types";

type TokenBody = {
  access_token: string;
  refresh_token: string;
  created_at: number;
  expires_in: number;
};

function parseTokenBody(body: TokenBody): TraktCreds {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    createdAt: body.created_at * 1000,
    expiresIn: body.expires_in,
  };
}

// Shared token refresh HTTP call used by refreshAuth and the refreshTokens job.
async function doTokenRefresh(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  refreshToken: string,
  shared: TraktSharedCreds,
): Promise<TraktCreds> {
  const res = await fetchFn(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: shared.clientId,
      client_secret: shared.clientSecret,
      grant_type: "refresh_token",
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
    }),
  });
  if (!res.ok) throw pluginError("plugin.token_expired", `Trakt refresh ${res.status}`);
  return parseTokenBody((await res.json()) as TokenBody);
}

export async function startAuth(ctx: unknown): Promise<AuthResult> {
  const c = ctx as Ctx;
  const shared = c.sharedCredentials as TraktSharedCreds | null;
  const clientId = shared?.clientId;
  if (!clientId) {
    return {
      status: "error" as const,
      code: "plugin.bad_credentials",
      devMessage: "Trakt clientId not configured",
    };
  }
  const res = await c.fetch(`${BASE}/oauth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!res.ok) {
    return {
      status: "error" as const,
      code: "plugin.upstream_error",
      devMessage: `Trakt ${res.status}`,
    };
  }
  const body = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  };
  return {
    status: "display_code" as const,
    code: body.user_code,
    verifyUrl: body.verification_url,
    pollState: { device_code: body.device_code },
    intervalSec: body.interval,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}

export async function pollAuth(ctx: unknown, pollState: unknown): Promise<AuthResult> {
  const c = ctx as Ctx;
  const state = pollState as { device_code: string };
  const shared = c.sharedCredentials as TraktSharedCreds | null;
  const clientId = shared?.clientId;
  const clientSecret = shared?.clientSecret;
  if (!clientId || !clientSecret) {
    return {
      status: "error",
      code: "plugin.bad_credentials",
      devMessage: "Trakt client not configured",
    };
  }
  const res = await c.fetch(`${BASE}/oauth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: state.device_code,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (res.status === 400 || res.status === 429) return { status: "pending" };
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
  return { status: "completed", credentials: parseTokenBody((await res.json()) as TokenBody) };
}

export async function refreshAuth(ctx: unknown, credentials: unknown): Promise<TraktCreds> {
  const c = ctx as Ctx;
  const creds = credentials as TraktCreds;
  const shared = c.sharedCredentials as TraktSharedCreds | null;
  if (!shared?.clientId || !shared?.clientSecret) {
    throw pluginError("plugin.bad_credentials", "Trakt client not configured");
  }
  return doTokenRefresh(c.fetch.bind(c), creds.refreshToken, shared as TraktSharedCreds);
}

export async function testConnection(ctx: unknown) {
  const c = ctx as Ctx;
  try {
    const res = await traktFetch(c, "/users/settings");
    if (res.status === 401) return { ok: false, message: "token invalid or expired" };
    if (!res.ok) return { ok: false, message: `Trakt ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: toErrorMessage(err) };
  }
}

// Job handler: refreshes tokens for connections expiring within the next hour.
export async function refreshTokensJob(ctx: unknown): Promise<TraktCreds | null> {
  const c = ctx as Ctx;
  const creds = c.credentials as TraktCreds | null;
  if (!creds) return null;
  const aboutToExpire = creds.createdAt + creds.expiresIn * 1000 - Date.now() < 60 * 60 * 1000;
  if (!aboutToExpire) return null;
  const shared = c.sharedCredentials as TraktSharedCreds | null;
  if (!shared?.clientId || !shared?.clientSecret) return null;
  return doTokenRefresh(c.fetch.bind(c), creds.refreshToken, shared as TraktSharedCreds);
}
