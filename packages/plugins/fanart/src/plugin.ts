import { definePlugin, toErrorMessage } from "@ent-mcp/plugin-sdk";
import { BASE } from "./constants";
import { resolveKey } from "./client";
import { artwork } from "./capabilities/artwork";
import type { Ctx } from "./types";

export default definePlugin({
  manifest: {
    id: "fanart",
    name: "Fanart.tv",
    version: "0.1.0",
    description:
      "High-resolution posters, backdrops, clear logos, and thumbs from fanart.tv. Admin configures one or more API keys; the host rotates across them on rate-limit.",
    author: { name: "Media Manager", url: "https://github.com/electather/media-manager" },
    homepage: "https://fanart.tv",
    logoUrl: "https://fanart.tv/favicon.ico",
    sdkVersion: "^1.0.0",
    allowedHosts: ["webservice.fanart.tv"],
    auth: { kind: "none" },
    globalConfigSchema: {
      type: "object",
      properties: {
        assetCdnPrefix: {
          type: "string",
          format: "uri",
          title: "Fanart asset CDN prefix",
          description:
            "Override the origin used in artwork URLs returned to the client. Useful when proxying fanart's CDN through your own caching layer. URLs are loaded browser-side via <img>, not via ctx.fetch, so this origin does not need to appear in `allowedHosts`.",
          default: "https://assets.fanart.tv",
        },
      },
      required: [],
    },
    sharedCredentialsSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "Fanart.tv personal API key",
          description:
            "Register at https://fanart.tv/get-an-api-key. Project keys may be added as additional pool entries for higher quota.",
          "x-secret": true,
        },
      },
      required: ["apiKey"],
    },
    capabilities: {
      artwork: {
        version: "v1",
        scope: "global",
        // Fanart accepts imdb for movies, TMDB does not — IMDB-only movie
        // items still get art when fanart is configured. TV is tvdb-only;
        // ArtworkService preflights tmdb→tvdb resolution before dispatch.
        supportedIdTypes: { movie: ["tmdb", "imdb"], tv: ["tvdb"] },
        // Lower = higher merge priority. Fanart is the primary provider; TMDB
        // (priority 20) fills any per-kind gaps fanart leaves empty.
        providerPriority: 10,
      },
    },
    poolable: true,
  },

  async verifyShared(ctx) {
    try {
      const c = ctx as Ctx;
      const key = resolveKey(c);
      // Use a known-good fixture title (Fight Club, tmdb 550) so the request
      // exercises the same code path real lookups will hit. A 200 or 404 both
      // count as "fanart reachable"; 401/403 mean the key is bad.
      const res = await c.fetch(`${BASE}/movies/550`, {
        headers: { "api-key": key },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `fanart auth rejected (${res.status})` };
      }
      if (!res.ok && res.status !== 404) {
        return { ok: false, message: `fanart ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

  capabilities: {
    artwork,
  },
});
