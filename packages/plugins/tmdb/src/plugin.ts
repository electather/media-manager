import { definePlugin, toErrorMessage } from "@nama/plugin-sdk";
import type { PluginContext } from "@nama/plugin-sdk";
import { resolveKey, applyAuth } from "./client";
import { metadata } from "./capabilities/metadata";
import { idResolve } from "./capabilities/id-resolve";
import { watchProviders } from "./capabilities/watch-providers";
import { trailers } from "./capabilities/trailers";
import { artwork } from "./capabilities/artwork";
import { BASE, TMDB_BUNDLED_KEY } from "./constants";
import type { Ctx } from "./types";

export default definePlugin({
  manifest: {
    id: "tmdb",
    name: "The Movie Database",
    version: "2.2.0",
    description:
      "Metadata and id-resolution provider powered by TMDB (themoviedb.org). Admin configures one or more API keys; the host rotates across them on rate-limit.",
    author: { name: "Nama", url: "https://github.com/" },
    sdkVersion: "^1.0.0",
    allowedHosts: ["api.themoviedb.org", "image.tmdb.org"],
    globalConfigSchema: {
      type: "object",
      properties: {
        imageBaseUrl: {
          type: "string",
          format: "uri",
          title: "Image base URL",
          description: "Override the default TMDB image CDN if needed.",
          default: "https://image.tmdb.org/t/p/",
        },
        artworkSizes: {
          type: "object",
          title: "Artwork size buckets",
          description:
            "Path segments used by `artwork@v1.getArtwork`. Keys mirror the bundle field names so admins see the same vocabulary in config and response. Override when serving via a CDN that uses different size names.",
          properties: {
            poster: { type: "string", default: "w780" },
            backdrop: { type: "string", default: "w1280" },
            clearLogo: { type: "string", default: "w500" },
          },
          additionalProperties: false,
        },
      },
      required: [],
    },
    sharedCredentialsSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "TMDB API key (v3 or v4 bearer)",
          "x-secret": true,
        },
      },
      required: ["apiKey"],
    },
    // Public by design (mirrors seerr); admin pool entry or user key overrides.
    // Synthesized as a read-only lowest-priority pool entry — see design §1.
    defaultSharedCredentials: { apiKey: TMDB_BUNDLED_KEY },
    auth: { kind: "none" },
    capabilities: {
      metadata: { version: "v1", scope: "global" },
      idResolve: { version: "v1", scope: "global" },
      watchProviders: { version: "v1", scope: "global" },
      trailers: { version: "v1", scope: "global" },
      artwork: {
        version: "v1",
        scope: "global",
        // TMDB only resolves art for items it knows by tmdb id. IMDB-only
        // movie items fall through to no provider — see fanart spec
        // §"Open Questions / Deferred" → "IMDB-only movie items".
        supportedIdTypes: { movie: ["tmdb"], tv: ["tmdb"] },
        // Lower = higher merge priority. TMDB acts as fallback so 20.
        providerPriority: 20,
      },
    },
    poolable: true,
  },

  async verifyShared(ctx) {
    try {
      const key = resolveKey(ctx as Ctx);
      const url = new URL(`${BASE}/configuration`);
      const init = applyAuth(url, key);
      const res = await (ctx as PluginContext).fetch(url.toString(), init);
      if (!res.ok) return { ok: false, message: `TMDB ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: toErrorMessage(err) };
    }
  },

  capabilities: {
    metadata,
    idResolve,
    watchProviders,
    trailers,
    artwork,
  },
});
