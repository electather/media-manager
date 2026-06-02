import type { LibraryFilters } from "./types";

/**
 * Hierarchical query-key factory for the library feature (skill rule 4). Filters
 * are part of the key on every filter-aware read, so each filter combination
 * gets its own cache entry and toggling a pill never reads a stale page.
 *
 * The four item lenses (`az`/`timeline`/`server`/`quality`) do NOT key here —
 * they serve through the shared media source and reuse `mediaKeys.source(
 * sourceId, params)` so a post-mutation `invalidateQueries({ queryKey:
 * mediaKeys.root })` sweeps them alongside home + watchlist. This factory owns
 * only the two reads with their own endpoints: collections and facets.
 */
export const libraryKeys = {
  all: ["library"] as const,
  /** Collections lens infinite query, scoped by the active filters. */
  collections: (filters: LibraryFilters) => [...libraryKeys.all, "collections", filters] as const,
  /** Unfiltered facet totals; no filter scoping (totals are whole-library). */
  facets: () => [...libraryKeys.all, "facets"] as const,
} as const;
