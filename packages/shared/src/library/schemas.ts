import { z } from "zod";
import { MEDIA_TYPES } from "../media/enums";
import { WATCHED_STATES } from "./enums";

export const LIBRARY_LIST_DEFAULT_LIMIT = 60;
export const LIBRARY_LIST_MAX_LIMIT = 200;

// Tolerant array param: Hono yields bare string for `?genres=Drama` but array for repeated.
// Coerces single value to one-element array; validation failure degrades to open axis
// (matching client URL parsing); mirrors apps/client/src/features/library/lib/search.ts.
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

// Shared by four item lenses (library-az, library-timeline, library-server, library-quality)
// via /api/media/sources/:sourceId route. Cursor decoded separately; not .strict() by design.
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
