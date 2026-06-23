import type { LensFilters } from "../repo";

/**
 * Single source of truth for filter axes (both collections + item-lens call this).
 * One-line-per-axis copy is established idiom (mirrors home/internal/adapters.ts#applyOptionalFields);
 * not extracted despite fallow flags because extracting obscures the single source.
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
