import { pluginError, handleHttpStatus, isPluginError } from "@nama/plugin-sdk";
import type { Ctx, SeerrRequestRow } from "./types";
import { SESSION_COOKIE_NAME } from "./constants";

// Error codes the host layer reacts to (token refresh, backoff, credential
// reconfig). Plugin methods that otherwise absorb errors into a graceful
// { ok: false } contract must still let these escape so the host can act.
const HOST_ACTIONABLE_CODES = new Set([
  "plugin.token_expired",
  "plugin.bad_credentials",
  "plugin.rate_limited",
]);

export function isHostActionable(err: unknown): boolean {
  return isPluginError(err) && HOST_ACTIONABLE_CODES.has(err.code);
}

export function getBaseUrl(ctx: Ctx): string {
  const url = ctx.config.global?.baseUrl;
  if (!url) throw pluginError("plugin.bad_credentials", "Seerr baseUrl not configured by admin");
  return url.replace(/\/$/, "");
}

export function getSessionCookie(ctx: Ctx): string {
  const cookie = ctx.credentials?.sessionCookie;
  if (!cookie)
    throw pluginError("plugin.token_expired", "Seerr session missing — please reconnect");
  return cookie;
}

// Extracts the `connect.sid=<value>` pair from the Set-Cookie headers returned
// by Seerr's auth endpoint. Seerr sessions are opaque to the host; we store
// the pair verbatim and replay it on every request.
export function extractSessionCookie(res: Response): string | null {
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

export async function seerrGet<T>(ctx: Ctx, path: string): Promise<T> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    headers: { Cookie: getSessionCookie(ctx) },
  });
  handleStatus(res);
  if (!res.ok) {
    const errBody = (await res.text()).slice(0, 200);
    throw pluginError("plugin.upstream_error", `Seerr ${res.status}: ${errBody}`);
  }
  return res.json() as Promise<T>;
}

export async function seerrPost<T>(ctx: Ctx, path: string, body: unknown): Promise<T> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: getSessionCookie(ctx),
    },
    body: JSON.stringify(body),
  });
  handleStatus(res);
  if (!res.ok) {
    const errBody = (await res.text()).slice(0, 200);
    throw pluginError("plugin.upstream_error", `Seerr ${res.status}: ${errBody}`);
  }
  return res.json() as Promise<T>;
}

// DELETE helper that does NOT throw on 404 — callers that treat 404 as
// idempotent success (e.g. cancelRequest) need to inspect the status themselves.
// 401 still translates to plugin.token_expired so auth refresh triggers.
export async function seerrDeleteRaw(ctx: Ctx, path: string): Promise<Response> {
  const res = await ctx.fetch(`${getBaseUrl(ctx)}/api/v1${path}`, {
    method: "DELETE",
    headers: { Cookie: getSessionCookie(ctx) },
  });
  if (res.status === 401) throw pluginError("plugin.token_expired", "Seerr auth rejected (401)");
  if (res.status === 429) throw pluginError("plugin.rate_limited", "Seerr rate limited (429)");
  if (res.status >= 500)
    throw pluginError("plugin.upstream_error", `Seerr server error (${res.status})`);
  return res;
}

/**
 * Fetches every request page from Seerr. Shared between the `listRequests`
 * capability and the per-connection sync job.
 */
export async function fetchAllRequests(ctx: Ctx): Promise<SeerrRequestRow[]> {
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
