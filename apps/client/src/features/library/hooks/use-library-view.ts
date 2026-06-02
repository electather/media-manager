import { useMemo } from "react";
import { applyLibraryFilters, collectFacetValues, computeFacetCounts } from "../lib/filtering";
import type { LibraryData, LibraryFilters } from "../lib/types";

interface UseLibraryViewArgs {
  data: LibraryData;
  filters: LibraryFilters;
}

/**
 * Derives every value the page renders from the raw payload plus the current
 * filter state: the filtered item set (what the lenses group), the available
 * facet values, and the per-option counts. Memoed so re-renders driven by
 * unrelated state (e.g. lens switch) stay cheap.
 */
export function useLibraryView({ data, filters }: UseLibraryViewArgs) {
  const filtered = useMemo(() => applyLibraryFilters(data.items, filters), [data.items, filters]);
  const facetValues = useMemo(() => collectFacetValues(data.items), [data.items]);
  const facetCounts = useMemo(() => computeFacetCounts(data.items), [data.items]);
  return { filtered, facetValues, facetCounts };
}
