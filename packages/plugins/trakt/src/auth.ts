import { pluginError, toErrorMessage } from "@nama/plugin-sdk";
import type { AuthResult } from "@nama/plugin-sdk";
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

// 1 hour upper bound for Retry-After hints; matches discord/ntfy/telegram.
const MAX_RETRY_AFTER_MS = 3_600_000;
// Default backoff when Trakt returns 429 with no Retry-After header.
const DEFAULT_RATE_LIMIT_RETRY_MS = 5 * 60 * 1000;

function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta <= 0) return 0;
    return Math.min(delta, MAX_RETRY_AFTER_MS);
  }
  return undefined;
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
  if (res.status === 429) {
    // Trakt rate-limits `/oauth/token` independently of refresh-token validity;
    // surfacing this as `plugin.token_expired` would push the user through
    // reconnect for no reason, so flag it as a retryable rate limit and let
    // the runner honour Retry-After.
    throw pluginError("plugin.rate_limited", `Trakt refresh 429`, {
      retryable: true,
      retryAfterMs: parseRetryAfterMs(res) ?? DEFAULT_RATE_LIMIT_RETRY_MS,
    });
  }
  if (!res.ok) {
    // Distinguish bad/expired refresh tokens (4xx) from transient upstream
    // failures (5xx) so a flaky Trakt does not force users back through auth.
    const code = res.status >= 500 ? "plugin.upstream_error" : "plugin.token_expired";
    throw pluginError(code, `Trakt refresh ${res.status}`);
  }
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
  return doTokenRefresh(c.fetch.bind(c), creds.refreshToken, shared);
}

// Verifies a shared client_id/secret pair before a user connection exists.
// `testConnection` needs a per-user access token, which doesn't exist yet at
// this point, so it always 401s regardless of credential validity. Hits the
// same device/code endpoint `startAuth` uses — only client_id is checked;
// client_secret can't be validated without completing the full device flow.
export async function verifyShared(ctx: unknown): Promise<{ ok: boolean; message?: string }> {
  const c = ctx as Ctx;
  const shared = c.sharedCredentials as TraktSharedCreds | null;
  if (!shared?.clientId) return { ok: false, message: "client id missing" };
  const res = await c.fetch(`${BASE}/oauth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: shared.clientId }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, message: "invalid client id" };
  return { ok: false, message: `Trakt ${res.status}` };
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
  return doTokenRefresh(c.fetch.bind(c), creds.refreshToken, shared);
}
