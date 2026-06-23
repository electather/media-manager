import type { LibraryFilters } from "./types";

/**
 * Item lenses reuse mediaKeys.source() so they're swept by mediaKeys.root invalidation.
 * This factory owns only collections and facets (their own endpoints).
 */
export const libraryKeys = {
  all: ["library"] as const,
  /** Collections lens infinite query, scoped by the active filters. */
  collections: (filters: LibraryFilters) => [...libraryKeys.all, "collections", filters] as const,
  /** Unfiltered facet totals; no filter scoping (totals are whole-library). */
  facets: () => [...libraryKeys.all, "facets"] as const,
} as const;
