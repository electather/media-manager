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
    staleTime: 60 * 1000,
  });

/**
 * The non-blocking facets read (skill rule 5: facets use `useQuery`, never a
 * Suspense reader, so a slow/failing facet fetch degrades the header to empty
 * pills instead of suspending the whole library route). One hook, one query
 * (rule 7). The count maps drive the popover badges + the A→Z letter rail +
 * the timeline decade markers; `facetValues` is the derived option list the
 * popover iterates, memoed off the query data so the popover does not re-derive
 * on unrelated re-renders.
 *
 * The query takes no filters — the totals are whole-library (not filter-aware,
 * matching the mock look) — so its key is a bare `libraryKeys.facets()`.
 */
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
