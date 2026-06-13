import { pluginError, handleHttpStatus } from "@nama/plugin-sdk";
import type { Ctx } from "./types";
import { BASE } from "./constants";

export function resolveKey(ctx: Ctx): string {
  const value = ctx.credentials?.apiKey ?? ctx.sharedCredentials?.apiKey;
  if (!value) {
    throw pluginError("plugin.bad_credentials", "no TMDB api key available (user or shared)");
  }
  return value;
}

function isBearer(key: string): boolean {
  return key.startsWith("eyJ");
}

export function applyAuth(url: URL, key: string): RequestInit {
  if (isBearer(key)) {
    return { headers: { Authorization: `Bearer ${key}` } };
  }
  url.searchParams.set("api_key", key);
  return {};
}

export async function tmdbGet(ctx: Ctx, path: string, params: Record<string, unknown> = {}) {
  const url = new URL(`${BASE}${path}`);
  const key = resolveKey(ctx);
  const init = applyAuth(url, key);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v as string | number | boolean | bigint));
  }
  const res = await ctx.fetch(url.toString(), init);
  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get("Retry-After") ?? 0) || undefined;
    ctx.pool.markExhausted({ retryAfterSec });
    throw pluginError("plugin.rate_limited", `TMDB rate-limited (429)`);
  }
  handleHttpStatus(res, "TMDB", {
    on401: "plugin.bad_credentials",
    on403: "plugin.bad_credentials",
  });
  if (!res.ok) {
    throw pluginError("plugin.upstream_error", `TMDB ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
