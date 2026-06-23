import { z } from "zod";
import { WATCHED_STATES } from "@nama/shared/library";
import { MEDIA_TYPES } from "@nama/shared/media";
import type { LibraryFilters } from "./types";

/** Tolerant array param: coerces single values to arrays, catches validation errors to degrade gracefully. */
function arrayParam<T extends z.ZodType>(item: T) {
  return z
    .preprocess(
      (value) => (value == null ? undefined : Array.isArray(value) ? value : [value]),
      z.array(item).optional(),
    )
    .catch(undefined);
}

/** URL search params schema for `/library`; empty axes omitted to keep fully-open library at bare `/library`. */
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
