import type { LensFilters } from "../repo";

/**
 * Projects a parsed wire query onto the repo {@link LensFilters} shape, dropping
 * omitted axes so the repo applies no filter for them. The single source of
 * truth for the filter-axis set: both the collections service path and the
 * item-lens media-source registrations call this, so adding a new filter axis
 * requires a change here only. Accepts `Partial<LensFilters>` directly — both
 * parsed query types (`LibraryLensQueryParsed`, `LibraryCollectionsQueryParsed`)
 * are structurally wider, so no hand-maintained mirror interface is needed.
 *
 * The one-line-per-axis copy is the established conditional-assignment idiom
 * (mirrors home/internal/adapters.ts#applyOptionalFields); fallow's
 * coverage-free CRAP estimate and clone detector flag it, but extracting it
 * would obscure this single source of truth for the filter-axis set.
 */
// fallow-ignore-next-line complexity
export function toLensFilters(query: Partial<LensFilters>): LensFilters {
  const filters: LensFilters = {};
  // fallow-ignore-next-line code-duplication
  if (query.kinds) filters.kinds = query.kinds;
  if (query.genres) filters.genres = query.genres;
  if (query.qualities) filters.qualities = query.qualities;
  if (query.servers) filters.servers = query.servers;
  if (query.watched) filters.watched = query.watched;
  return filters;
}
