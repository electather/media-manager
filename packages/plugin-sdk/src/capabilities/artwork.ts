import { z } from "zod";
import { artworkBundleSchema, artworkIdMapSchema, ARTWORK_KINDS } from "@ent-mcp/shared/artwork";
import { defineCapability, method } from "../define";

/**
 * artwork@v1 — HD posters, backdrops, clear logos, and thumbs per item.
 * Aggregate dispatch: every eligible provider runs in parallel and the host
 * merges per-kind in `providerPriority` order. Plugins implementing this
 * capability declare which id types they can serve via `supportedIdTypes`
 * and their merge priority via `providerPriority` in the manifest's
 * capabilities entry.
 *
 * See `docs/2026-04-26-plugin-fanart-design.md` for the full design.
 */
export const ArtworkV1 = defineCapability({
  id: "artwork",
  version: "v1",
  strategy: { kind: "aggregate_per_kind", perKindFields: ARTWORK_KINDS },
  scope: "global",
  defaultCacheTtlSec: 60 * 60 * 24, // 24h positive
  negativeCacheTtlSec: 60 * 60 * 6, // 6h negative — fanart misses are stable
  defaultTimeoutMs: 10_000,
  methods: {
    getArtwork: method(
      z.object({
        ids: artworkIdMapSchema,
        type: z.enum(["movie", "tv"]),
        languages: z.array(z.string().min(2).max(8)).max(8).default(["en", "00"]),
      }),
      artworkBundleSchema,
    ),
  },
});

/**
 * Manifest-level shape every artwork@v1 provider declares. Validated at plugin
 * install — see `validatePluginModule` in the SDK.
 */
export interface ArtworkV1ManifestExtras {
  version: "v1";
  scope: "global";
  /** Id types this provider can serve per media type. The dispatcher's
   *  `canServe` filter drops the provider when no overlap with the call's
   *  `ids` exists. */
  supportedIdTypes: {
    movie: readonly ("tmdb" | "imdb" | "tvdb")[];
    tv: readonly ("tmdb" | "imdb" | "tvdb")[];
  };
  /** Merge priority. Lower = higher priority; ties broken alphabetical by
   *  plugin id. Recommended: 10 for primary providers, 20+ for fallbacks. */
  providerPriority: number;
}
