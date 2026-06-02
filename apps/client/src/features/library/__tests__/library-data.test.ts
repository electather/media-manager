import { describe, expect, it } from "vite-plus/test";
import {
  applyLibraryFilters,
  computeFacetCounts,
  countActiveFilters,
  watchedStateOf,
} from "../lib/filtering";
import { groupByDecade, groupByLetter, groupByQuality, groupByServer } from "../lib/grouping";
import { EMPTY_FILTERS, type LibraryFilters, type LibraryItem } from "../lib/types";

/** Minimal item builder so each test states only the fields it exercises. */
function item(overrides: Partial<LibraryItem> & Pick<LibraryItem, "id" | "title">): LibraryItem {
  return {
    tmdbId: overrides.id,
    mediaType: "movie",
    year: 2020,
    ...overrides,
  } as LibraryItem;
}

function withServers(labels: string[]): LibraryItem["availability"] {
  return {
    hasAnyServerCopy: true,
    requestEligible: false,
    servers: labels.map((label) => ({ id: label, label })),
  };
}

const filters = (overrides: Partial<LibraryFilters>): LibraryFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

describe("watchedStateOf", () => {
  // The watched facet depends on a correct three-way split; an off-by-one
  // here would mis-bucket half-watched series as finished.
  it("classifies untouched, partial, and finished progress", () => {
    expect(watchedStateOf(item({ id: "a", title: "A" }))).toBe("unwatched");
    expect(watchedStateOf(item({ id: "b", title: "B", progress: { watched: 0, total: 10 } }))).toBe(
      "unwatched",
    );
    expect(watchedStateOf(item({ id: "c", title: "C", progress: { watched: 4, total: 10 } }))).toBe(
      "partial",
    );
    expect(
      watchedStateOf(item({ id: "d", title: "D", progress: { watched: 10, total: 10 } })),
    ).toBe("watched");
  });
});

describe("applyLibraryFilters", () => {
  const items = [
    item({
      id: "tv:dune",
      title: "Dune",
      mediaType: "tv",
      genres: ["Sci-Fi"],
      tags: ["4K HDR"],
      availability: withServers(["Plex"]),
    }),
    item({
      id: "movie:heat",
      title: "Heat",
      mediaType: "movie",
      genres: ["Crime"],
      tags: ["HDR"],
      availability: withServers(["Jellyfin"]),
    }),
    item({
      id: "movie:drive",
      title: "Drive",
      mediaType: "movie",
      genres: ["Crime", "Drama"],
      tags: ["4K"],
      availability: withServers(["Plex", "Jellyfin"]),
    }),
  ];

  it("filters by kind, genre, quality and server independently", () => {
    expect(applyLibraryFilters(items, filters({ kinds: ["tv"] })).map((i) => i.id)).toEqual([
      "tv:dune",
    ]);
    expect(applyLibraryFilters(items, filters({ genres: ["Crime"] })).map((i) => i.id)).toEqual([
      "movie:heat",
      "movie:drive",
    ]);
    expect(applyLibraryFilters(items, filters({ qualities: ["4K HDR"] })).map((i) => i.id)).toEqual(
      ["tv:dune"],
    );
    expect(applyLibraryFilters(items, filters({ servers: ["Jellyfin"] })).map((i) => i.id)).toEqual(
      ["movie:heat", "movie:drive"],
    );
  });
});

describe("computeFacetCounts", () => {
  it("counts each option once per item, even with multi-valued facets", () => {
    const items = [
      item({
        id: "movie:a",
        title: "A",
        genres: ["Drama"],
        tags: ["4K", "HDR"],
        availability: withServers(["Plex"]),
      }),
      item({
        id: "movie:b",
        title: "B",
        genres: ["Drama"],
        tags: ["HDR"],
        availability: withServers(["Plex"]),
      }),
    ];
    const counts = computeFacetCounts(items);
    expect(counts.genres.Drama).toBe(2);
    expect(counts.qualities.HDR).toBe(2);
    expect(counts.qualities["4K"]).toBe(1);
    expect(counts.servers.Plex).toBe(2);
    expect(counts.watched.unwatched).toBe(2);
  });
});

describe("countActiveFilters", () => {
  it("sums selections across every axis", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(countActiveFilters(filters({ kinds: ["movie"], genres: ["Drama", "Crime"] }))).toBe(3);
  });
});

describe("grouping", () => {
  it("buckets titles A–Z with a trailing # group, alphabetically sorted", () => {
    const groups = groupByLetter([
      item({ id: "1", title: "Zephyr" }),
      item({ id: "2", title: "9 Songs" }),
      item({ id: "3", title: "Arrival" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["A", "Z", "#"]);
  });

  it("orders decades newest-first", () => {
    const groups = groupByDecade([
      item({ id: "1", title: "Old", year: 1994 }),
      item({ id: "2", title: "New", year: 2021 }),
      item({ id: "3", title: "Mid", year: 2008 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["2020s", "2000s", "1990s"]);
  });

  it("collects yearless titles into a trailing unknown bucket so they stay visible", () => {
    const groups = groupByDecade([
      item({ id: "1", title: "Dated", year: 2021 }),
      item({ id: "2", title: "Yearless", year: undefined }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2020", "unknown"]);
    expect(groups.at(-1)?.items.map((i) => i.id)).toEqual(["2"]);
  });

  it("renders a yearless-only set instead of dropping every row", () => {
    const groups = groupByDecade([item({ id: "1", title: "Yearless", year: undefined })]);
    expect(groups.map((g) => g.key)).toEqual(["unknown"]);
  });

  it("orders quality tiers by descending fidelity and lists an item under each tag", () => {
    const groups = groupByQuality([item({ id: "1", title: "A", tags: ["Atmos", "4K HDR"] })]);
    expect(groups.map((g) => g.key)).toEqual(["4K HDR", "Atmos"]);
    expect(groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it("lists a title under every server that hosts it", () => {
    const groups = groupByServer([
      item({ id: "1", title: "A", availability: withServers(["Plex", "Jellyfin"]) }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["Jellyfin", "Plex"]);
  });
});
