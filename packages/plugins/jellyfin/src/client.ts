import { pluginError, handleHttpStatus } from "@nama/plugin-sdk";
import type { Ctx, JellyfinUserCfg } from "./types";
import { CLIENT_NAME, CLIENT_VERSION, DEVICE_NAME, DEVICE_ID } from "./constants";

export function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function getUserCfg(ctx: Ctx): JellyfinUserCfg {
  const cfg = ctx.config.user;
  if (!cfg?.externalServerUrl) {
    throw pluginError("plugin.bad_credentials", "Jellyfin externalServerUrl not configured");
  }
  return cfg;
}

// Picks the base URL the plugin uses for server-to-server `ctx.fetch`.
// Prefers `internalServerUrl` (e.g. `http://jellyfin:8096` inside docker);
// falls back to `externalServerUrl` when the admin has not configured an
// internal URL. Public links (playerLink / webLink) always use the
// external URL — see `getExternalBase`.
export function pickFetchBase(userConfig: JellyfinUserCfg): string {
  return trimSlash(userConfig.internalServerUrl?.trim() || userConfig.externalServerUrl);
}

export function getExternalBase(userConfig: JellyfinUserCfg): string {
  return trimSlash(userConfig.externalServerUrl);
}

export function getAccessToken(ctx: Ctx): string {
  const token = ctx.credentials?.accessToken;
  if (!token) {
    throw pluginError("plugin.token_expired", "Jellyfin session missing — please reconnect");
  }
  return token;
}

// Re-auth is the only way to repopulate `userId` — the field is
// `readOnly` on the form so the client cannot resubmit it through a
// userConfig edit.
export function getUserId(ctx: Ctx): string {
  const id = ctx.config.user?.userId;
  if (!id) {
    throw pluginError(
      "plugin.token_expired",
      "Jellyfin userId not cached — please reconnect to refresh the connection",
    );
  }
  return id;
}

// Jellyfin's auth endpoint requires the verbose `MediaBrowser ...`
// Authorization header even before a token has been issued. Building it
// here keeps the client-identity tuple in one place so the pre-auth
// header (used by `startAuth`) and the post-auth header (used by every
// subsequent request) can never drift.
export function unauthenticatedAuthHeader(): string {
  return `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`;
}

export function authHeader(token: string): Record<string, string> {
  // Strip characters that would terminate a quoted `"…"` header value or
  // inject a new header: an adversarial server returning a token with
  // `"`, CR, or LF would otherwise corrupt the Authorization header.
  // Jellyfin tokens are opaque random strings in practice, so this is
  // defence-in-depth rather than known-exploitable.
  const safeToken = token.replace(/["\r\n]/g, "");
  return {
    "X-Emby-Token": safeToken,
    Authorization: `${unauthenticatedAuthHeader()}, Token="${safeToken}"`,
  };
}

export function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "plugin.item_not_found"
  );
}

export async function jellyfinFetch(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const cfg = getUserCfg(ctx);
  const base = pickFetchBase(cfg);
  const token = getAccessToken(ctx);
  const headers = {
    accept: "application/json",
    ...authHeader(token),
    ...(init.headers as Record<string, string> | undefined),
  };
  return ctx.fetch(`${base}${path}`, { ...init, headers });
}

export async function jellyfinJson<T>(ctx: Ctx, path: string, init: RequestInit = {}): Promise<T> {
  const res = await jellyfinFetch(ctx, path, init);
  handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
  if (!res.ok) {
    throw pluginError("plugin.upstream_error", `Jellyfin ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// Fire-and-forget POST — returns only whether Jellyfin accepted the
// request. 401/429/5xx translate through `handleHttpStatus` so the host
// can refresh tokens and back off.
export async function jellyfinFireAndForget(ctx: Ctx, path: string): Promise<{ ok: boolean }> {
  const res = await jellyfinFetch(ctx, path, { method: "POST" });
  handleHttpStatus(res, "Jellyfin", { on401: "plugin.token_expired" });
  return { ok: res.ok };
}
