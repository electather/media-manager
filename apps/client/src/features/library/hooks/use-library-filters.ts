import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { filtersToSearch, librarySearchSchema, searchToFilters } from "../lib/search";
import { EMPTY_FILTERS, type LibraryFilters } from "../lib/types";

/** Syncs facet filters to URL; `strict: false` allows use in shared layout; `replace` prevents history spam. */
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
