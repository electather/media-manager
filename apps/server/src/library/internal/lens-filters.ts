import type { LensFilters } from "../repo";

/**
 * The minimal query shape both the collections service path and the item-lens
 * media-source registrations need for filter projection. Every axis is optional
 * so callers that omit an axis apply no filter for it.
 */
interface FilterQuery {
  kinds?: LensFilters["kinds"];
  genres?: LensFilters["genres"];
  qualities?: LensFilters["qualities"];
  servers?: LensFilters["servers"];
  watched?: LensFilters["watched"];
}

/**
 * Projects the parsed wire query onto the repo {@link LensFilters} shape,
 * dropping omitted axes so the repo applies no filter for them. The single
 * source of truth for the filter-axis set: both the collections service path
 * and the item-lens media-source registrations call this, so adding a new
 * filter axis requires a change here only.
 */
export function toLensFilters(query: FilterQuery): LensFilters {
  const filters: LensFilters = {};
  if (query.kinds) filters.kinds = query.kinds;
  if (query.genres) filters.genres = query.genres;
  if (query.qualities) filters.qualities = query.qualities;
  if (query.servers) filters.servers = query.servers;
  if (query.watched) filters.watched = query.watched;
  return filters;
}
