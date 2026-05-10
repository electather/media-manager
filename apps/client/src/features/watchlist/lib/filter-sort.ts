import type { WatchlistBuckets, WatchlistFilter, WatchlistItem, WatchlistSort } from "./types";

const FILTER_TO_BUCKETS: Record<
  Exclude<WatchlistFilter, "all" | "upcoming">,
  readonly (keyof WatchlistBuckets)[]
> = {
  available: ["available", "inProgress"],
  "in-progress": ["inProgress"],
  requested: ["requested", "unavailable"],
};

/**
 * Picks the right slice for a given filter, falling back to the upcoming
 * mock when the live `upcoming` bucket is empty so the filtered grid stays
 * legible during the mock-data phase.
 */
// fallow-ignore-next-line complexity
export function filterItems(
  items: readonly WatchlistItem[],
  buckets: WatchlistBuckets,
  upcomingMock: readonly WatchlistItem[],
  filter: WatchlistFilter,
): WatchlistItem[] {
  if (filter === "all") return items.slice();
  if (filter === "upcoming") {
    const live = buckets.upcoming;
    return live.length > 0 ? live.slice() : upcomingMock.slice();
  }
  const groups = FILTER_TO_BUCKETS[filter];
  const out: WatchlistItem[] = [];
  for (const group of groups) out.push(...buckets[group]);
  return out;
}

const RUNTIME_FALLBACK = 999;

// fallow-ignore-next-line complexity
const byRuntimeAsc = (a: WatchlistItem, b: WatchlistItem): number =>
  (a.facets?.runtimeMin ?? RUNTIME_FALLBACK) - (b.facets?.runtimeMin ?? RUNTIME_FALLBACK);

export function sortItems(items: WatchlistItem[], sort: WatchlistSort): WatchlistItem[] {
  if (sort === "alpha") return items.toSorted((a, b) => a.title.localeCompare(b.title));
  if (sort === "runtime") return items.toSorted(byRuntimeAsc);
  return items;
}
