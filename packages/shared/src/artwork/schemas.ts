import { z } from "zod";
import { ARTWORK_ERROR_CODES, MAX_VARIANTS_PER_KIND } from "./enums";

/**
 * Schemas for artwork wire types. Used by the SDK capability definition
 * (`artwork@v1`) and the `artwork.get` RPC route. Bundle fields are arrays
 * always (empty when nothing found) so the dispatcher's per-kind merge has
 * a stable shape to walk.
 */

export const artworkVariantSchema = z.object({
  url: z.url(),
  language: z.string().min(2).max(8),
  likes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const artworkBundleSchema = z.object({
  poster: z.array(artworkVariantSchema).max(MAX_VARIANTS_PER_KIND),
  backdrop: z.array(artworkVariantSchema).max(MAX_VARIANTS_PER_KIND),
  clearLogo: z.array(artworkVariantSchema).max(MAX_VARIANTS_PER_KIND),
  thumb: z.array(artworkVariantSchema).max(MAX_VARIANTS_PER_KIND),
});

export const artworkIdMapSchema = z
  .object({
    tmdb: z.string().regex(/^\d+$/).optional(),
    imdb: z
      .string()
      .regex(/^tt\d+$/)
      .optional(),
    tvdb: z.string().regex(/^\d+$/).optional(),
  })
  .refine((v) => Boolean(v.tmdb ?? v.imdb ?? v.tvdb), {
    message: "at least one id (tmdb, imdb, tvdb) must be provided",
  });

export const artworkRequestItemSchema = z.object({
  key: z.string().min(1).max(128),
  ids: artworkIdMapSchema,
  type: z.enum(["movie", "tv"]),
});

export const artworkErrorSchema = z.object({
  code: z.enum(ARTWORK_ERROR_CODES),
  message: z.string(),
});

export const artworkGetResponseSchema = z.object({
  results: z.record(z.string(), artworkBundleSchema),
  errors: z.record(z.string(), artworkErrorSchema).optional(),
  generatedAt: z.number().int().nonnegative(),
});
