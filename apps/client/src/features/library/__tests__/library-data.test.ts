import { describe, expect, it } from "vite-plus/test";
import type { CompactMediaItem } from "@nama/shared/media";
import { countActiveFilters, watchedStateOf } from "../lib/filtering";
import { type LibrarySectionEntry, toSectionEntries, toSections } from "../lib/section-groups";
import { EMPTY_FILTERS, type LibraryFilters } from "../lib/types";

/** Minimal item builder so each test states only the fields it exercises. */
function item(
  overrides: Partial<CompactMediaItem> & Pick<CompactMediaItem, "id" | "title">,
): CompactMediaItem {
  return {
    tmdbId: overrides.id,
    mediaType: "movie",
    year: 2020,
    ...overrides,
  } as CompactMediaItem;
}

/** Collapse an entry list to a comparable `[type, key|id, sectionKey?]` shape. */
function shape(entries: LibrarySectionEntry[]) {
  return entries.map((e) =>
    e.type === "header"
      ? { type: "header", key: e.key, label: e.label }
      : { type: "item", id: e.item.id, sectionKey: e.sectionKey },
  );
}

const filters = (overrides: Partial<LibraryFilters>): LibraryFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

describe("watchedStateOf", () => {
  // The watched facet depends on a correct three-way split; an off-by-one
  // here would mis-bucket half-watched series as finished. The card's own
  // watched badge reads this directly even though the server now drives the
  // filter axis, so the classification must stay correct on the client.
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

describe("countActiveFilters", () => {
  // The trigger badge and the "clear all" enabled state both key off this sum;
  // dropping an axis here would silently hide active filters from the user.
  it("sums selections across every axis", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(countActiveFilters(filters({ kinds: ["movie"], genres: ["Drama", "Crime"] }))).toBe(3);
  });
});

describe("toSectionEntries", () => {
  // The server now returns a flat sorted stream and the client splices headers
  // on group-key change. These tests pin the per-lens key derivation and the
  // "header only when the key changes" invariant — the visual grouping the old
  // server-side `groupBy*` functions used to produce now lives entirely here.

  it("inserts an A→Z header on first-letter change, article-stripped", () => {
    const entries = toSectionEntries(
      [
        item({ id: "1", title: "An Anvil" }),
        item({ id: "2", title: "Avalanche" }),
        item({ id: "3", title: "Bridge" }),
      ],
      "az",
    );
    // "An Anvil" files under A (article stripped); A then B, one header each.
    expect(shape(entries)).toEqual([
      { type: "header", key: "A", label: "A" },
      { type: "item", id: "1", sectionKey: "A" },
      { type: "item", id: "2", sectionKey: "A" },
      { type: "header", key: "B", label: "B" },
      { type: "item", id: "3", sectionKey: "B" },
    ]);
  });

  it("buckets non-alphabetic leads under # for the A→Z lens", () => {
    const entries = toSectionEntries([item({ id: "1", title: "9 Songs" })], "az");
    expect(entries[0]).toEqual({ type: "header", key: "#", label: "#" });
  });

  it("buckets timeline headers by stable, i18n-free decade keys (label === key)", () => {
    // section-groups stays locale-free: the timeline header key AND label are
    // the same stable token (the decade's lead year, or "unknown"). The visible
    // "2020s" / "Unknown year" text is resolved at the render boundary by
    // `timelineSectionLabel`, so this layer must NOT carry display copy.
    const entries = toSectionEntries(
      [
        item({ id: "1", title: "New", year: 2021 }),
        item({ id: "2", title: "Old", year: 1994 }),
        item({ id: "3", title: "Yearless", year: undefined }),
      ],
      "timeline",
    );
    const headers = entries.filter((e) => e.type === "header");
    expect(headers).toEqual([
      { type: "header", key: "2020", label: "2020" },
      { type: "header", key: "1990", label: "1990" },
      { type: "header", key: "unknown", label: "unknown" },
    ]);
  });

  it("uses the server-supplied section and keys repeats by id+section for server/quality", () => {
    // The server/quality lenses repeat a title once per section (json_each),
    // so the same id appears under two headers — the list MUST key on
    // id+sectionKey, not id alone, or React would collapse the duplicate.
    const entries = toSectionEntries(
      [
        item({ id: "tv:1", title: "Dune", section: { id: "plex", label: "Plex" } }),
        item({ id: "tv:1", title: "Dune", section: { id: "jelly", label: "Jellyfin" } }),
      ],
      "server",
    );
    expect(shape(entries)).toEqual([
      { type: "header", key: "plex", label: "Plex" },
      { type: "item", id: "tv:1", sectionKey: "plex" },
      { type: "header", key: "jelly", label: "Jellyfin" },
      { type: "item", id: "tv:1", sectionKey: "jelly" },
    ]);
  });

  it("emits no duplicate header while the group key holds steady", () => {
    const entries = toSectionEntries(
      [
        item({ id: "1", title: "Apple" }),
        item({ id: "2", title: "Acorn" }),
        item({ id: "3", title: "Apex" }),
      ],
      "az",
    );
    expect(entries.filter((e) => e.type === "header")).toHaveLength(1);
  });
});

describe("toSections", () => {
  // `toSections` re-shapes the flat header-delimited entry stream into discrete
  // sections so each lens renders a `SectionHead` over its own virtualized grid.
  // The split must keep every item under the right header and carry `sectionKey`
  // so the grid keys repeated titles (server/quality) by `id + sectionKey`.

  it("groups items under their preceding header in stream order", () => {
    const sections = toSections(
      toSectionEntries(
        [
          item({ id: "1", title: "Apple" }),
          item({ id: "2", title: "Acorn" }),
          item({ id: "3", title: "Bridge" }),
        ],
        "az",
      ),
    );
    expect(
      sections.map((section) => ({
        key: section.key,
        label: section.label,
        ids: section.items.map((entry) => entry.item.id),
      })),
    ).toEqual([
      { key: "A", label: "A", ids: ["1", "2"] },
      { key: "B", label: "B", ids: ["3"] },
    ]);
  });

  it("keeps a title in both sections it repeats across for server/quality", () => {
    // The json_each expansion emits one row per (title, section); the split must
    // preserve the repeat so the same title appears under each server section.
    const sections = toSections(
      toSectionEntries(
        [
          item({ id: "tv:1", title: "Dune", section: { id: "plex", label: "Plex" } }),
          item({ id: "tv:1", title: "Dune", section: { id: "jelly", label: "Jellyfin" } }),
        ],
        "server",
      ),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ key: "plex", label: "Plex" });
    expect(sections[0]?.items[0]).toEqual({
      item: expect.objectContaining({ id: "tv:1" }),
      sectionKey: "plex",
    });
    expect(sections[1]?.items[0]).toEqual({
      item: expect.objectContaining({ id: "tv:1" }),
      sectionKey: "jelly",
    });
  });

  it("returns no sections for an empty stream", () => {
    expect(toSections([])).toEqual([]);
  });
});
