import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { filtersToSearch, librarySearchSchema, searchToFilters } from "../lib/search";
import { EMPTY_FILTERS, type LibraryFilters } from "../lib/types";

/**
 * Reads the active facet filters from the URL search params shared by the
 * `/library/*` route family and writes changes back. `strict: false` lets the
 * hook sit in the layout header above every lens route without a per-route
 * binding. Writes target the current route (`to: "."`) so toggling a filter
 * keeps the active lens, and `replace` keeps rapid pill toggles out of history.
 */
export function useLibraryFilters() {
  const navigate = useNavigate();
  // `strict: false` lets this hook sit in the shared `/library/*` layout header
  // without a per-route binding. Re-validating with the schema (rather than
  // casting the untyped record) keeps the degradation explicit: mounted outside
  // the route family the parse fails and filters fall back to `EMPTY_FILTERS`.
  const rawSearch = useSearch({ strict: false });
  const filters = useMemo(
    () => searchToFilters(librarySearchSchema.safeParse(rawSearch).data ?? {}),
    [rawSearch],
  );

  const setFilters = useCallback(
    (next: LibraryFilters) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, ...filtersToSearch(next) }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  const resetFilters = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters]);

  return { filters, setFilters, resetFilters };
}
