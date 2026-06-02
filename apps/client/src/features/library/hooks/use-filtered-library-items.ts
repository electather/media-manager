import { useMemo } from "react";
import { applyLibraryFilters } from "../lib/filtering";
import type { LibraryData, LibraryFilters } from "../lib/types";

/**
 * The one place the active filters are applied to the raw payload. Both the
 * header (which needs the count) and the lens pages (which group the set) read
 * through this so the filtered array is derived — and memoed — once per shape.
 */
export function useFilteredLibraryItems(data: LibraryData, filters: LibraryFilters) {
  return useMemo(() => applyLibraryFilters(data.items, filters), [data.items, filters]);
}
