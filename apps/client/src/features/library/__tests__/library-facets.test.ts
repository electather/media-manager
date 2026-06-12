import { describe, expect, it } from "vite-plus/test";
import type { LibraryFacetCounts } from "@nama/shared/library";
import { deriveFacetValues, libraryOwnedTotal } from "../lib/facets";
import { shouldFetchNext } from "../components/lenses/library-section-grid";

/**
 * Build a partial facet-counts payload with the fields a test exercises; the
 * untouched axes default to empty so each case states only what it asserts.
 */
function counts(overrides: Partial<LibraryFacetCounts>): LibraryFacetCounts {
  return {
    kinds: { movie: 0, tv: 0 },
    genres: {},
    qualities: {},
    servers: {},
    watched: { watched: 0, partial: 0, unwatched: 0 },
    letters: [],
    decades: [],
    ...overrides,
  } as LibraryFacetCounts;
}

describe("shouldFetchNext", () => {
  // The infinite-scroll sentinel and the keyboard "load more" button both route
  // through this predicate, so the two affordances can never disagree. The guard
  // exists to stop a second page firing while the first is mid-flight; if it ever
  // returned true while fetching, the list would double-request and duplicate
  // rows. The truth table below is the whole contract — every cell must hold.
  it("fetches ONLY when another page exists and none is in flight", () => {
    expect(shouldFetchNext(true, false)).toBe(true);
    // A fetch already running: holding the cursor is what prevents the dupe.
    expect(shouldFetchNext(true, true)).toBe(false);
    // No further cursor: nothing to fetch regardless of in-flight state.
    expect(shouldFetchNext(false, false)).toBe(false);
    expect(shouldFetchNext(false, true)).toBe(false);
  });
});

describe("deriveFacetValues", () => {
  // The filter popover's option lists are the sorted key sets of the count maps
  // (the server only emits a bucket that has at least one owned title). Sorting
  // is pinned to `en` collation so the fa build keeps the same option order, and
  // an empty axis must yield `[]` so the popover renders no stray group.
  it("returns each axis's keys sorted by key, empty axes as []", () => {
    const values = deriveFacetValues(
      counts({ genres: { Drama: 3, Crime: 1 }, qualities: {}, servers: { Plex: 2 } }),
    );
    // Sorted by KEY (Crime < Drama), NOT by count — a count-sort would put Drama
    // first here, so the order pins the key-collation contract.
    expect(values.genres).toEqual(["Crime", "Drama"]);
    expect(values.servers).toEqual(["Plex"]);
    expect(values.qualities).toEqual([]);
  });

  it("returns all-empty before the (non-blocking) facets read lands", () => {
    // The facets query is non-blocking, so the popover renders while `counts`
    // is still undefined; it must show no options rather than throw.
    expect(deriveFacetValues(undefined)).toEqual({ genres: [], qualities: [], servers: [] });
  });
});

describe("libraryOwnedTotal", () => {
  // The header eyebrow shows the whole-library owned total — the sum of the
  // per-KIND facet counts, matching the unfiltered facets semantics. It must NOT
  // sum genres/servers/etc. (those double-count titles across multi-valued axes),
  // and it must read 0 before the facets land so the eyebrow shows nothing
  // rather than a partial number.
  it("sums the per-kind counts only", () => {
    expect(libraryOwnedTotal(counts({ kinds: { movie: 2, tv: 1 } }))).toBe(3);
  });

  it("ignores the multi-valued axes (not a sum of genres)", () => {
    // Genres/servers expand per title, so summing them would over-count; the
    // total stays kinds-only even when those axes carry larger numbers.
    const total = libraryOwnedTotal(
      counts({ kinds: { movie: 2, tv: 1 }, genres: { Drama: 9, Crime: 9 }, servers: { Plex: 9 } }),
    );
    expect(total).toBe(3);
  });

  it("returns 0 before the facets land", () => {
    expect(libraryOwnedTotal(undefined)).toBe(0);
  });
});
