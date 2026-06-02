import { useMemo } from "react";
import { applyLibraryFilters } from "../lib/filtering";
import { useLibrary } from "./use-library";
import { useLibraryFilters } from "./use-library-filters";

/**
 * Data + filter plumbing every lens page shares: the filtered item set the
 * lens groups, the collections passthrough, and the reset handler the empty
 * state calls. The lens components stay dumb (props only); this hook is the
 * single seam each lens route mounts on.
 */
export function useLibraryContent() {
  const { data } = useLibrary();
  const { filters, resetFilters } = useLibraryFilters();
  const items = useMemo(() => applyLibraryFilters(data.items, filters), [data.items, filters]);
  return { items, collections: data.collections, isEmpty: items.length === 0, resetFilters };
}
