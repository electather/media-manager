import { pluginError, handleHttpStatus } from "@ent-mcp/plugin-sdk";
import { BASE, DEFAULT_LANGUAGES } from "../constants";
import { parseRetryAfterSec, resolveKey } from "../client";
import { emptyBundle, shapeBundle } from "../mappers";
import type { Ctx, FanartResponse } from "../types";

/**
 * Pick the single id this provider can use for a given request. Movies prefer
 * tmdb over imdb (cheaper lookup; fewer redirects). TV is tvdb-only since
 * fanart's tv endpoint indexes by TVDB id exclusively.
 */
function pickId(
  ids: { tmdb?: string; imdb?: string; tvdb?: string },
  type: "movie" | "tv",
): string | undefined {
  if (type === "movie") return ids.tmdb ?? ids.imdb;
  return ids.tvdb;
}

export const artwork = {
  async getArtwork(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { ids, type, languages } = input as {
      ids: { tmdb?: string; imdb?: string; tvdb?: string };
      type: "movie" | "tv";
      languages?: string[];
    };
    const id = pickId(ids, type);
    if (!id) {
      // Defensive — the dispatcher's `canServe` filter should drop us before
      // invoke when no supported id is present. Keeping the guard lets unit
      // tests exercise the same error path the dispatcher contract relies on.
      throw pluginError(
        "plugin.input_invalid",
        `fanart cannot serve ${type} without ${type === "movie" ? "tmdb|imdb" : "tvdb"} id`,
      );
    }

    const apiKey = resolveKey(c);
    const path =
      type === "movie" ? `/movies/${encodeURIComponent(id)}` : `/tv/${encodeURIComponent(id)}`;
    const res = await c.fetch(`${BASE}${path}`, { headers: { "api-key": apiKey } });

    // 404 = item absent from fanart's catalog. Common for niche titles and
    // not an error — return an empty bundle so the dispatcher merges TMDB's
    // result and caches the (now-known-empty) fanart contribution.
    if (res.status === 404) return emptyBundle();

    // 429/503 signal rate-limit or upstream outage. Mark the pool exhausted
    // with the upstream-suggested retry-after so the host rotates the key
    // on the next attempt instead of hammering a tarpit.
    if (res.status === 429 || res.status === 503) {
      const retryAfterSec = parseRetryAfterSec(res.headers.get("Retry-After"));
      c.pool.markExhausted({ retryAfterSec });
      throw pluginError("plugin.rate_limited", `fanart returned ${res.status}`, {
        retryable: true,
        retryAfterMs: retryAfterSec * 1000,
      });
    }

    handleHttpStatus(res, "fanart", {
      // Fanart returns 401 for revoked keys and 403 for "project key required";
      // map both to plugin.bad_credentials so the admin sees an actionable
      // error in /connections instead of an opaque "no artwork" result.
      on401: "plugin.bad_credentials",
      on403: "plugin.bad_credentials",
    });
    // `handleHttpStatus` only throws for the well-known codes it handles
    // (401/403/404/429/5xx). A non-2xx response that slips through — e.g. a
    // 400 from a malformed id — would otherwise be JSON-parsed and shaped
    // into an empty bundle, masking the upstream failure as "no artwork"
    // and poisoning the negative cache. Treat anything non-OK as an
    // upstream error so the dispatcher logs the rejection and falls back
    // to TMDB instead.
    if (!res.ok) {
      throw pluginError("plugin.upstream_error", `fanart returned ${res.status}`);
    }

    let json: FanartResponse;
    try {
      json = (await res.json()) as FanartResponse;
    } catch {
      // Fanart occasionally serves an HTML error page with a 200 status when
      // their CDN hiccups. Wrap the parse failure as `upstream_error` and
      // intentionally drop the body — passing it through would let an HTML
      // payload leak into operator logs.
      throw pluginError("plugin.upstream_error", "fanart returned malformed JSON");
    }

    const cdnOverride = c.config.global?.assetCdnPrefix;
    const langs = languages ?? [...DEFAULT_LANGUAGES];
    return shapeBundle(json, type, langs, cdnOverride);
  },
};
