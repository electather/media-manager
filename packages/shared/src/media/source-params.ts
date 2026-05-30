import { z } from "zod";
import { MOOD_IDS } from "../watchlist/enums";
import { itemsQuerySchema, moodItemsQuerySchema } from "../watchlist/schemas";
import { mediaTypeSchema } from "./schema-base";

/**
 * Per-source request param schemas, discriminated per source (design §A5). The
 * generic resolver picks the schema off the source registration and parses
 * `c.req.query` against it (invalid → 400 `http.invalid_input`).
 *
 * The watchlist shapes reuse today's `itemsQuerySchema` / `moodItemsQuerySchema`
 * verbatim so the unified wire keeps the exact validation the per-product
 * endpoints enforce. The home shapes (seeded / bounded / void) are
 * additive — they strip the opaque `cursor` query key (the resolver decodes it
 * separately, design §A3), so they are intentionally not `.strict()`.
 */

/** `watchlist-items` params: `{ bucket?, sort, mood?, limit, cursor? }`. */
export const watchlistItemsParamsSchema = itemsQuerySchema;
export type WatchlistItemsParams = z.infer<typeof watchlistItemsParamsSchema>;

/**
 * `watchlist-mood-items` params: `{ moodId, limit, cursor? }`. `moodId` is the
 * old `/moods/:moodId/items` path param folded into the unified source query.
 */
export const watchlistMoodItemsParamsSchema = moodItemsQuerySchema.extend({
  moodId: z.enum(MOOD_IDS),
});
export type WatchlistMoodItemsParams = z.infer<typeof watchlistMoodItemsParamsSchema>;

/** Seeded home params (`similarTo`): the seed the client encodes into its cursor. */
export const seededHomeParamsSchema = z.object({
  seedId: z.string().min(1),
  seedType: mediaTypeSchema,
});
export type SeededHomeParams = z.infer<typeof seededHomeParamsSchema>;

/** Bounded source params (`watchlist-recently`): a single capped limit. */
export const boundedParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type BoundedParams = z.infer<typeof boundedParamsSchema>;

/** Void source params: home discovery rows and `watchlist-tonight` take none. */
export const voidParamsSchema = z.object({});
export type VoidParams = z.infer<typeof voidParamsSchema>;
