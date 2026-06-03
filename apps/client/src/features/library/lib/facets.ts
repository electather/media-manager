import type { LibraryFacetCounts } from "@ent-mcp/shared/library";

/** The value lists the filter popover offers per multi-valued axis. */
export interface LibraryFacetValues {
  genres: string[];
  qualities: string[];
  servers: string[];
}

/**
 * Derive the popover's option lists from the facet count maps. The keys of each
 * count record ARE the present values (the server only emits a bucket that has
 * at least one owned title), so the option list is the sorted key set — no
 * separate value endpoint needed. Pinned to `en` collation so the fa build keeps
 * the same option order. Pure (no React) so it is unit-testable on its own.
 */
export function deriveFacetValues(counts: LibraryFacetCounts | undefined): LibraryFacetValues {
  if (!counts) return { genres: [], qualities: [], servers: [] };
  const sorted = (record: Record<string, number>) =>
    Object.keys(record).sort((a, b) => a.localeCompare(b, "en"));
  return {
    genres: sorted(counts.genres),
    qualities: sorted(counts.qualities),
    servers: sorted(counts.servers),
  };
}

/**
 * The whole-library owned-title total: the sum of the per-kind facet counts.
 * This is the header eyebrow's count, matching the unfiltered facets semantics
 * (totals are whole-library, not filter-aware). Returns `0` when the facets have
 * not landed yet so the eyebrow shows nothing rather than a partial number.
 * Pure so it is unit-testable without rendering the header.
 */
export function libraryOwnedTotal(counts: LibraryFacetCounts | undefined): number {
  if (!counts) return 0;
  return Object.values(counts.kinds).reduce((sum, n) => sum + n, 0);
}
