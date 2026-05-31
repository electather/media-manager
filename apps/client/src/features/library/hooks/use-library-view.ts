import { useMemo } from "react";
import {
  applyLibraryFilters,
  collectFacetValues,
  computeFacetCounts,
  computeStats,
} from "../lib/filtering";
import type { LibraryData, LibraryFilters } from "../lib/types";

interface UseLibraryViewArgs {
  data: LibraryData;
  query: string;
  filters: LibraryFilters;
}

/**
 * Derives every value the page renders from the raw payload plus the current
 * search/filter state: the filtered item set (what the lenses group), the
 * stats roll-up, the available facet values, and the per-option counts. Memoed
 * so re-renders driven by unrelated state (e.g. lens switch) stay cheap.
 */
export function useLibraryView({ data, query, filters }: UseLibraryViewArgs) {
  const filtered = useMemo(
    () => applyLibraryFilters(data.items, filters, query),
    [data.items, filters, query],
  );
  const stats = useMemo(() => computeStats(filtered), [filtered]);
  const facetValues = useMemo(() => collectFacetValues(data.items), [data.items]);
  const facetCounts = useMemo(() => computeFacetCounts(data.items), [data.items]);
  return { filtered, stats, facetValues, facetCounts };
}
