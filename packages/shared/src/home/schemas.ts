import { z } from "zod";

/** `home.getLayout` takes no input. Strict empty schema rejects extra keys. */
export const homeGetLayoutInputSchema = z.object({}).strict();

/**
 * `home.getRowContent` input: client supplies a row id and the opaque cursor
 * from the previous page. Null cursor means first page. Decoding/validating
 * the cursor itself is server-internal and lives outside `@ent-mcp/shared`.
 *
 * `rowId` is an opaque registry slug — multiple rows can share the same
 * `RowKind` (e.g. `recommendedForYou-tv` and `recommendedForYou-movies`),
 * so the wire enum cannot validate it.
 */
export const homeGetRowContentInputSchema = z
  .object({
    rowId: z.string().min(1),
    cursor: z.string().nullable(),
  })
  .strict();

/**
 * `home.getDetails` input: tmdb id + media type (the only fields needed to
 * key both the catalog read and the dispatch-cached `metadata@v1.getDetails`
 * call).
 */
export const homeGetDetailsInputSchema = z
  .object({
    tmdbId: z.string().min(1),
    mediaType: z.enum(["movie", "tv"]),
  })
  .strict();

/**
 * `home.getSeasonAvailability` input: tmdb id of the show. Per-server presence
 * is the only thing the route returns — canonical seasons ride on
 * `home.getDetails` (different cache TTL).
 */
export const homeGetSeasonAvailabilityInputSchema = z
  .object({
    tmdbId: z.string().min(1),
  })
  .strict();

export type HomeGetLayoutInput = z.infer<typeof homeGetLayoutInputSchema>;
export type HomeGetRowContentInput = z.infer<typeof homeGetRowContentInputSchema>;
export type HomeGetDetailsInput = z.infer<typeof homeGetDetailsInputSchema>;
export type HomeGetSeasonAvailabilityInput = z.infer<typeof homeGetSeasonAvailabilityInputSchema>;
