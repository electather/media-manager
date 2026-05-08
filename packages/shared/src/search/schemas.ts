import { z } from "zod";
import { compactMediaItemSchema } from "../home/schemas";

/**
 * Kinds the `/api/search` endpoint accepts. `all` returns mixed media. `tv`
 * and `movie` filter the underlying catalog read so the command menu can
 * scope a search-mode drill without a client-side filter pass.
 */
export const SEARCH_KINDS = ["tv", "movie", "all"] as const;
export const searchKindSchema = z.enum(SEARCH_KINDS);

/**
 * Query for `GET /api/search`. `q` cap of 80 chars deters pathological
 * substring scans; `limit` cap of 50 matches the discover endpoints. Defaults
 * are tuned for the command menu (`kind: "all"`, `limit: 20`).
 */
export const searchQuerySchema = z
  .object({
    q: z.string().min(1).max(80),
    kind: searchKindSchema.default("all"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/**
 * Response shape — `results` are wire-format `CompactMediaItem` so the menu
 * shares its row component with the home feed. `hasMore` is true when the
 * underlying scan returned more than `limit` rows.
 */
export const searchResponseSchema = z
  .object({
    results: z.array(compactMediaItemSchema),
    hasMore: z.boolean(),
  })
  .strict();
