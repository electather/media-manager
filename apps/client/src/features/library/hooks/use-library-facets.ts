import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { deriveFacetValues, type LibraryFacetValues } from "../lib/facets";
import { fetchFacets } from "../lib/fetchers";
import { libraryKeys } from "../lib/query-keys";

export type { LibraryFacetValues };

/**
 * The one facets query definition, shared by the hook and the layout route
 * loader (which warms it via `ensureQueryData`) so the cache key matches and the
 * header never refetches. Totals are whole-library, so the key is unscoped.
 */
export const facetsQueryOptions = () =>
  queryOptions({
    queryKey: libraryKeys.facets(),
    queryFn: fetchFacets,
  });

/** Non-blocking read: slow/failing fetch degrades header to empty pills instead of suspending route. Totals are whole-library (not filter-aware). */
export function useLibraryFacets() {
  const query = useQuery(facetsQueryOptions());
  const facetValues = useMemo(() => deriveFacetValues(query.data), [query.data]);
  return {
    facetCounts: query.data,
    facetValues,
    isLoading: query.isLoading,
    error: query.error,
  };
}
