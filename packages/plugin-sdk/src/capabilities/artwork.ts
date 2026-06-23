import { z } from "zod";
import {
  artworkBundleSchema,
  artworkIdMapSchema,
  ARTWORK_KINDS,
  ARTWORK_ID_TYPES,
} from "@nama/shared/artwork";
import { defineCapability, method } from "../define";
import { mediaTypeSchema } from "@nama/shared";

/**
 * artwork@v1 — posters, backdrops, logos, thumbs per item. Parallel aggregate dispatch
 * merged per-kind by `providerPriority` (design 2026-04-26-plugin-fanart-design.md).
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
        type: mediaTypeSchema,
        languages: z.array(z.string().min(2).max(8)).max(8).default(["en", "00"]),
      }),
      artworkBundleSchema,
    ),
  },
});

/**
 * Manifest-level shape for artwork@v1 providers. Zod schema is runtime source
 * of truth for validation and eligibility checks; TypeScript interface derived for static guidance.
 */
export const artworkV1ManifestExtrasSchema = z.object({
  version: z.literal("v1"),
  scope: z.literal("global"),
  /** Id types this provider can serve per media type. The dispatcher's
   *  `canServe` filter drops the provider when no overlap with the call's
   *  `ids` exists. */
  supportedIdTypes: z.object({
    movie: z.array(z.enum(ARTWORK_ID_TYPES)).min(1),
    tv: z.array(z.enum(ARTWORK_ID_TYPES)).min(1),
  }),
  /** Merge priority. Lower = higher priority; ties broken alphabetical by
   *  plugin id. Recommended: 10 for primary providers, 20+ for fallbacks. */
  providerPriority: z.number().int().min(0).max(1000),
});

export type ArtworkV1ManifestExtras = z.infer<typeof artworkV1ManifestExtrasSchema>;
