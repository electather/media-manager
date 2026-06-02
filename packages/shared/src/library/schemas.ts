import { z } from "zod";
import { MEDIA_TYPES } from "../media/enums";
import { WATCHED_STATES } from "./enums";

export const LIBRARY_LIST_DEFAULT_LIMIT = 60;
export const LIBRARY_LIST_MAX_LIMIT = 200;

/**
 * A tolerant array query param. Hono yields a bare string for a single
 * occurrence (`?genres=Drama`) and an array for a repeated one, so this coerces
 * the single value to a one-element array. Anything that fails item validation
 * (a stray value from a hand-edited link) degrades to an open axis rather than
 * 400-ing the request, matching the client's URL parsing. Mirrors
 * `apps/client/src/features/library/lib/search.ts`.
 */
function arrayParam<T extends z.ZodTypeAny>(item: T) {
  return z
    .preprocess(
      (value) => (value == null ? undefined : Array.isArray(value) ? value : [value]),
      z.array(item).optional(),
    )
    .catch(undefined);
}

/** Shared facet filter axes; an empty/omitted axis applies no filter. */
const filterShape = {
  kinds: arrayParam(z.enum(MEDIA_TYPES)),
  genres: arrayParam(z.string()),
  qualities: arrayParam(z.string()),
  servers: arrayParam(z.string()),
  watched: arrayParam(z.enum(WATCHED_STATES)),
};

const cursorSchema = z.string().min(1).max(512).optional();

const limitSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(LIBRARY_LIST_MAX_LIMIT)
  .default(LIBRARY_LIST_DEFAULT_LIMIT);

/**
 * Query schema shared by the four item lenses (`library-az`, `library-timeline`,
 * `library-server`, `library-quality`) served through the unified
 * `/api/media/sources/:sourceId` route. The opaque `cursor` is decoded
 * separately by the source resolver, so this is intentionally not `.strict()`.
 */
export const libraryLensQuerySchema = z.object({
  cursor: cursorSchema,
  limit: limitSchema,
  ...filterShape,
});
export type LibraryLensQueryInput = z.input<typeof libraryLensQuerySchema>;
export type LibraryLensQueryParsed = z.infer<typeof libraryLensQuerySchema>;

/** `GET /api/library/collections` query: same filter axes as the item lenses. */
export const libraryCollectionsQuerySchema = z.object({
  cursor: cursorSchema,
  limit: limitSchema,
  ...filterShape,
});
export type LibraryCollectionsQueryInput = z.input<typeof libraryCollectionsQuerySchema>;
export type LibraryCollectionsQueryParsed = z.infer<typeof libraryCollectionsQuerySchema>;
