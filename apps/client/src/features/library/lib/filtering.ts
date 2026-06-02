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

/** Classify a title by how far through it the user is. */
export function watchedStateOf(item: LibraryItem): WatchedState {
  const progress = item.progress;
  if (!progress || progress.total <= 0 || progress.watched <= 0) return "unwatched";
  if (progress.watched >= progress.total) return "watched";
  return "partial";
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

function matchesFilters(item: LibraryItem, filters: LibraryFilters): boolean {
  if (filters.kinds.length > 0 && !filters.kinds.includes(item.mediaType)) return false;
  if (filters.genres.length > 0 && !genresOf(item).some((g) => filters.genres.includes(g))) {
    return false;
  }
  if (
    filters.qualities.length > 0 &&
    !qualitiesOf(item).some((q) => filters.qualities.includes(q))
  ) {
    return false;
  }
  if (filters.servers.length > 0 && !serversOf(item).some((s) => filters.servers.includes(s))) {
    return false;
  }
  if (filters.watched.length > 0 && !filters.watched.includes(watchedStateOf(item))) return false;
  return true;
}

/** Apply the facet filters to the catalog. */
export function applyLibraryFilters(items: LibraryItem[], filters: LibraryFilters): LibraryItem[] {
  return items.filter((item) => matchesFilters(item, filters));
}

/**
 * How many items match each facet option, counted across the whole catalog so
 * the badges stay stable as the user toggles pills (design: facet count badges).
 * Single-valued axes (kind, watched) fall straight out of `countBy`; the
 * multi-valued axes count each distinct value an item carries exactly once.
 */
export function computeFacetCounts(items: LibraryItem[]): LibraryFacetCounts {
  const watched = countBy(items, watchedStateOf) as Partial<Record<WatchedState, number>>;
  const counts: LibraryFacetCounts = {
    kinds: countBy(items, (item) => item.mediaType),
    genres: {},
    qualities: {},
    servers: {},
    watched: {
      watched: watched.watched ?? 0,
      partial: watched.partial ?? 0,
      unwatched: watched.unwatched ?? 0,
    },
  };
  const bump = (record: Record<string, number>, key: string) => {
    record[key] = (record[key] ?? 0) + 1;
  };
  for (const item of items) {
    for (const genre of uniq(genresOf(item))) bump(counts.genres, genre);
    for (const quality of uniq(qualitiesOf(item))) bump(counts.qualities, quality);
    for (const server of uniq(serversOf(item))) bump(counts.servers, server);
  }
  return counts;
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
