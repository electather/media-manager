import { countBy, uniq } from "es-toolkit";
import type { LibraryFacetCounts, LibraryFilters, LibraryItem, WatchedState } from "./types";

/** The quality tiers and servers a facet can offer, derived from the item set. */
export function qualitiesOf(item: LibraryItem): string[] {
  return item.tags ?? [];
}

export function serversOf(item: LibraryItem): string[] {
  return item.availability?.servers.map((server) => server.label) ?? [];
}

export function genresOf(item: LibraryItem): string[] {
  return item.genres ?? [];
}

/** Whether an item carries started-but-meaningful progress worth classifying. */
function hasProgress(
  progress: LibraryItem["progress"],
): progress is NonNullable<LibraryItem["progress"]> {
  return progress != null && progress.total > 0 && progress.watched > 0;
}

/** Classify a title by how far through it the user is. */
export function watchedStateOf(item: LibraryItem): WatchedState {
  const progress = item.progress;
  if (!hasProgress(progress)) return "unwatched";
  return progress.watched >= progress.total ? "watched" : "partial";
}

/** Sorted unique values for a facet axis across the whole catalog. */
export function collectFacetValues(items: LibraryItem[]): {
  genres: string[];
  qualities: string[];
  servers: string[];
} {
  return {
    genres: uniq(items.flatMap(genresOf)).sort(),
    qualities: uniq(items.flatMap(qualitiesOf)).sort(),
    servers: uniq(items.flatMap(serversOf)).sort(),
  };
}

/** Does an item satisfy a single facet axis? An empty axis matches everything. */
function matchesAxis(selected: readonly string[], values: readonly string[]): boolean {
  return selected.length === 0 || values.some((value) => selected.includes(value));
}

function matchesFilters(item: LibraryItem, filters: LibraryFilters): boolean {
  const axes: [readonly string[], readonly string[]][] = [
    [filters.kinds, [item.mediaType]],
    [filters.genres, genresOf(item)],
    [filters.qualities, qualitiesOf(item)],
    [filters.servers, serversOf(item)],
    [filters.watched, [watchedStateOf(item)]],
  ];
  return axes.every(([selected, values]) => matchesAxis(selected, values));
}

/** Apply the facet filters to the catalog. */
export function applyLibraryFilters(items: LibraryItem[], filters: LibraryFilters): LibraryItem[] {
  return items.filter((item) => matchesFilters(item, filters));
}

/** Count how many items carry each distinct value on a multi-valued axis. */
function countValues(
  items: LibraryItem[],
  valuesOf: (item: LibraryItem) => string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const value of uniq(valuesOf(item))) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
  }
  return counts;
}

/** Tally the three watched buckets, filling any absent bucket with zero. */
function countWatched(items: LibraryItem[]): Record<WatchedState, number> {
  const counts = countBy(items, watchedStateOf) as Partial<Record<WatchedState, number>>;
  return {
    watched: counts.watched ?? 0,
    partial: counts.partial ?? 0,
    unwatched: counts.unwatched ?? 0,
  };
}

/**
 * How many items match each facet option, counted across the whole catalog so
 * the badges stay stable as the user toggles pills (design: facet count badges).
 * Single-valued axes (kind, watched) fall straight out of `countBy`; the
 * multi-valued axes count each distinct value an item carries exactly once.
 */
export function computeFacetCounts(items: LibraryItem[]): LibraryFacetCounts {
  return {
    kinds: countBy(items, (item) => item.mediaType),
    genres: countValues(items, genresOf),
    qualities: countValues(items, qualitiesOf),
    servers: countValues(items, serversOf),
    watched: countWatched(items),
  };
}

/** Total number of selected options across every facet axis. */
export function countActiveFilters(filters: LibraryFilters): number {
  return (
    filters.kinds.length +
    filters.genres.length +
    filters.qualities.length +
    filters.servers.length +
    filters.watched.length
  );
}
