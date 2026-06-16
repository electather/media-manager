import { QUALITY_TIERS, type LibraryFacetCounts } from "@nama/shared/library";

/** The value lists the filter popover offers per multi-valued axis. */
export interface LibraryFacetValues {
  genres: string[];
  qualities: string[];
  servers: string[];
}

/**
 * Fidelity ordinal for a quality label: its index in the hi→lo `QUALITY_TIERS`
 * tuple (0 = highest fidelity), or the tuple length for any free-form label the
 * tuple does not list (so unknown labels sink below every listed tier). Mirrors
 * the server's `rankQualityTier` so the popover order matches the descending
 * fidelity the Quality lens uses; the canonical rank tuple is shared, so the two
 * agree value-for-value without a duplicate rank definition.
 */
function rankQualityTier(label: string): number {
  const index = (QUALITY_TIERS as readonly string[]).indexOf(label);
  return index === -1 ? QUALITY_TIERS.length : index;
}

/**
 * Derive the popover's option lists from the facet count maps. The keys of each
 * count record ARE the present values (the server only emits a bucket that has
 * at least one owned title), so the option list is the sorted key set — no
 * separate value endpoint needed. Genres and servers sort alphabetically (pinned
 * to `en` collation so the fa build keeps the same option order); qualities sort
 * by descending fidelity rank, falling back to `en` collation for ties (two
 * labels the tuple does not list). Pure (no React) so it is unit-testable.
 */
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
