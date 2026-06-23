import { pluginError, handleHttpStatus } from "@nama/plugin-sdk";
import type { Ctx, PlexUserCfg } from "./types";
import {
  PLEX_PRODUCT,
  PLEX_CLIENT_IDENTIFIER,
  PLEX_DEVICE,
  PLEX_VERSION,
  PLEX_PLATFORM,
} from "./constants";

export function plexTvHeaders(accept: "json" | "xml" = "json"): Record<string, string> {
  return {
    Accept: accept === "json" ? "application/json" : "application/xml",
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Client-Identifier": PLEX_CLIENT_IDENTIFIER,
    "X-Plex-Device": PLEX_DEVICE,
    "X-Plex-Version": PLEX_VERSION,
    "X-Plex-Platform": PLEX_PLATFORM,
  };
}

export function serverHeaders(ctx: Ctx): Record<string, string> {
  const token = ctx.credentials?.authToken;
  if (!token) {
    throw pluginError("plugin.token_expired", "Plex auth token missing — please reconnect");
  }
  return {
    Accept: "application/json",
    "X-Plex-Token": token,
    "X-Plex-Client-Identifier": PLEX_CLIENT_IDENTIFIER,
  };
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function readUserConfig(ctx: Ctx): PlexUserCfg {
  const cfg = ctx.config?.user;
  if (!cfg) {
    throw pluginError("plugin.bad_credentials", "Plex connection config missing");
  }
  return cfg;
}

/**
 * Fetch URL base (internal if configured, else external).
 * Fallback allows self-hosted without docker-network shortcut to route via public URL.
 */
export function pickFetchBase(cfg: PlexUserCfg): string {
  const base = cfg.internalServerUrl ?? cfg.externalServerUrl;
  if (!base) {
    throw pluginError(
      "plugin.bad_credentials",
      "Plex externalServerUrl not configured on connection",
    );
  }
  return stripTrailingSlash(base);
}

/**
 * URL base used to build outward-facing links (playerLink / webLink). Always
 * the external URL — never the internal/docker one — because the link is
 * consumed by the caller's browser, not the host.
 */
export function externalBase(cfg: PlexUserCfg): string {
  if (!cfg.externalServerUrl) {
    throw pluginError(
      "plugin.bad_credentials",
      "Plex externalServerUrl not configured on connection",
    );
  }
  return stripTrailingSlash(cfg.externalServerUrl);
}

export async function plexServerFetch(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const cfg = readUserConfig(ctx);
  const url = `${pickFetchBase(cfg)}${path}`;
  const headers = { ...serverHeaders(ctx), ...(init.headers as Record<string, string>) };
  // Disable automatic redirect following so that X-Plex-Token is never
  // forwarded to a third-party host via a redirect response.
  const res = await ctx.fetch(url, { ...init, headers, redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    throw pluginError("plugin.upstream_error", `Plex returned unexpected redirect (${res.status})`);
  }
  return res;
}

/**
 * Signal pool on 429, then throw `plugin.rate_limited`.
 * Must route all fetches through this (or `plexServerJson`) — bare throw without
 * `markExhausted` leaves pool unaware and causes retry stampede.
 */
export function throwIfRateLimited(res: Response, ctx: Ctx): void {
  if (res.status !== 429) return;
  const retryAfterSec = Number(res.headers.get("Retry-After") ?? 0) || undefined;
  ctx.pool.markExhausted({ retryAfterSec });
  throw pluginError("plugin.rate_limited", "Plex rate limited (429)");
}

export async function plexServerJson<T>(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await plexServerFetch(ctx, path, init);
  throwIfRateLimited(res, ctx);
  handleHttpStatus(res, "Plex", { on401: "plugin.token_expired" });
  if (!res.ok) {
    throw pluginError("plugin.upstream_error", `Plex ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}
