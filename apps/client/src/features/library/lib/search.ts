import { z } from "zod";
import { MEDIA_TYPES } from "@ent-mcp/shared/media";
import { WATCHED_STATES, type LibraryFilters } from "./types";

/**
 * A tolerant array search param. A single value (`?kinds=movie`) is coerced to
 * a one-element array, and anything that fails validation (a stray value from a
 * hand-edited or legacy link) degrades to an open axis rather than throwing the
 * whole route into its error boundary.
 */
function arrayParam<T extends z.ZodType>(item: T) {
  return z
    .preprocess(
      (value) => (value == null ? undefined : Array.isArray(value) ? value : [value]),
      z.array(item).optional(),
    )
    .catch(undefined);
}

/**
 * The facet filters live in the URL search params of the `/library` layout
 * route so the shared header and the active lens sub-route read one source of
 * truth (and so a filtered view stays shareable / restorable across reloads).
 * Every axis is optional; an empty axis is omitted entirely (see
 * {@link filtersToSearch}) to keep a fully-open library at a bare `/library`.
 */
export const librarySearchSchema = z.object({
  kinds: arrayParam(z.enum(MEDIA_TYPES)),
  genres: arrayParam(z.string()),
  qualities: arrayParam(z.string()),
  servers: arrayParam(z.string()),
  watched: arrayParam(z.enum(WATCHED_STATES)),
});

export type LibrarySearch = z.infer<typeof librarySearchSchema>;

/** Hydrate the page's filter state from the (validated) URL search params. */
export function searchToFilters(search: LibrarySearch): LibraryFilters {
  const axis = <T>(values: T[] | undefined): T[] => values ?? [];
  return {
    kinds: axis(search.kinds),
    genres: axis(search.genres),
    qualities: axis(search.qualities),
    servers: axis(search.servers),
    watched: axis(search.watched),
  };
}

/** Serialize filter state back to search params, dropping empty axes from the URL. */
export function filtersToSearch(filters: LibraryFilters): LibrarySearch {
  const orUndefined = <T>(values: T[]): T[] | undefined => (values.length > 0 ? values : undefined);
  return {
    kinds: orUndefined(filters.kinds),
    genres: orUndefined(filters.genres),
    qualities: orUndefined(filters.qualities),
    servers: orUndefined(filters.servers),
    watched: orUndefined(filters.watched),
  };
}
