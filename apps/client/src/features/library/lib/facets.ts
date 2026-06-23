import { QUALITY_TIERS, type LibraryFacetCounts } from "@nama/shared/library";

/** The value lists the filter popover offers per multi-valued axis. */
export interface LibraryFacetValues {
  genres: string[];
  qualities: string[];
  servers: string[];
}

/** Rank quality label by position in `QUALITY_TIERS` (unknown labels sink below listed tiers); mirrors server `rankQualityTier` to keep popover order in sync. */
function rankQualityTier(label: string): number {
  const index = (QUALITY_TIERS as readonly string[]).indexOf(label);
  return index === -1 ? QUALITY_TIERS.length : index;
}

/** Keys of count maps are present values; sort genres/servers alphabetically (en-pinned for consistent FA builds), qualities by fidelity rank then en collation. */
export function deriveFacetValues(counts: LibraryFacetCounts | undefined): LibraryFacetValues {
  if (!counts) return { genres: [], qualities: [], servers: [] };
  const alpha = (record: Record<string, number>) =>
    Object.keys(record).sort((a, b) => a.localeCompare(b, "en"));
  const byQualityTier = Object.keys(counts.qualities).sort(
    (a, b) => rankQualityTier(a) - rankQualityTier(b) || a.localeCompare(b, "en"),
  );
  return {
    genres: alpha(counts.genres),
    qualities: byQualityTier,
    servers: alpha(counts.servers),
  };
}

/** Sum of per-kind facet counts (whole-library, not filter-aware); returns `0` until facets land to avoid showing partial numbers. */
export function libraryOwnedTotal(counts: LibraryFacetCounts | undefined): number {
  if (!counts) return 0;
  return Object.values(counts.kinds).reduce((sum, n) => sum + n, 0);
}
