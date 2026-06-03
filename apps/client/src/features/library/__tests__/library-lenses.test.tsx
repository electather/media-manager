// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { LibraryCollection } from "@ent-mcp/shared/library";
import type { CompactMediaItem } from "@ent-mcp/shared/media";

/**
 * Mock the shared `VirtualGrid` so these tests exercise the lenses' own wiring
 * without a real virtualizer or layout (happy-dom reports zero sizes, which the
 * real grid turns into zero mounted rows). The mock renders EVERY item through
 * the lens-supplied `renderItem`/`getKey` synchronously and records the props
 * each grid instance was handed, so a test can assert which section wired
 * `onEndReached` and what key shape `getKey` produced. We never mock React
 * Query — the lenses take their data as props.
 */
interface CapturedGrid {
  items: readonly unknown[];
  getKey: (item: unknown, index: number) => string;
  onEndReached?: () => void;
}
const grids = vi.hoisted(() => ({ captured: [] as CapturedGrid[] }));

vi.mock("@/shared/components/virtualized", () => ({
  VirtualGrid: <T,>({
    items,
    getKey,
    renderItem,
    onEndReached,
  }: {
    items: readonly T[];
    getKey: (item: T, index: number) => string;
    renderItem: (item: T, index: number) => ReactNode;
    onEndReached?: () => void;
  }) => {
    grids.captured.push({
      items,
      getKey: getKey as (item: unknown, index: number) => string,
      onEndReached,
    });
    return (
      <div data-grid>
        {items.map((item, index) => (
          <div key={getKey(item, index)} data-cell>
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  },
}));

const { LibrarySectionGrid } = await import("../components/lenses/library-section-grid");
const { CollectionsLens } = await import("../components/lenses/collections-lens");
const { AzLens } = await import("../components/lenses/az-lens");
const { TimelineLens } = await import("../components/lenses/timeline-lens");
const { LibraryCard } = await import("../components/library-card");
const { toSectionEntries } = await import("../lib/section-groups");

/** Minimal compact item builder — each test names only the fields it exercises. */
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

beforeEach(() => {
  grids.captured.length = 0;
});
afterEach(() => cleanup());

describe("LibrarySectionGrid infinite-scroll wiring", () => {
  // Only the LAST section's grid may carry `onEndReached`, so the single
  // end-of-stream sentinel drives the next-page fetch; if a middle section wired
  // it, scrolling past it would fire spurious fetches. And the sentinel must be
  // guarded — invoking it while a fetch is in flight (or with no next page) must
  // NOT call `fetchNextPage`, or the list would double-request.
  it("wires onEndReached on the last section only and keys cells by id+section", () => {
    const entries = toSectionEntries(
      [
        item({ id: "tv:1", title: "Dune", section: { id: "plex", label: "Plex" } }),
        item({ id: "tv:1", title: "Dune", section: { id: "jelly", label: "Jellyfin" } }),
      ],
      "server",
    );
    const fetchNextPage = vi.fn(async () => undefined);
    render(
      <LibrarySectionGrid
        entries={entries}
        hasNextPage
        isFetchingNextPage={false}
        fetchNextPage={fetchNextPage}
      />,
    );

    // Two sections (Plex, Jellyfin) → two grids; only the last gets the sentinel.
    expect(grids.captured).toHaveLength(2);
    expect(grids.captured[0]?.onEndReached).toBeUndefined();
    expect(grids.captured[1]?.onEndReached).toBeTypeOf("function");

    // getKey salts the repeated title with its section so the two Dune rows stay
    // distinct DOM cells (server/quality lenses repeat a title per section).
    const plexEntry = grids.captured[0]!.items[0];
    const jellyEntry = grids.captured[1]!.items[0];
    expect(grids.captured[0]!.getKey(plexEntry, 0)).toBe("tv:1-plex");
    expect(grids.captured[1]!.getKey(jellyEntry, 0)).toBe("tv:1-jelly");

    // The sentinel fires the next page when a cursor exists and none is in flight.
    grids.captured[1]!.onEndReached!();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("guards the sentinel: no fetch while a page is already in flight", () => {
    const entries = toSectionEntries([item({ id: "1", title: "Apple" })], "az");
    const fetchNextPage = vi.fn(async () => undefined);
    render(
      <LibrarySectionGrid
        entries={entries}
        hasNextPage
        isFetchingNextPage
        fetchNextPage={fetchNextPage}
      />,
    );
    grids.captured[grids.captured.length - 1]!.onEndReached!();
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});

describe("CollectionsLens card", () => {
  // The card fans the server preview but caps the visible posters at four
  // (`preview.slice(0, 4)`), while the count badge shows the franchise's FULL
  // owned size from the server — not the fanned subset. Pinning preview.length=6
  // and count=7 catches a regression that swaps the badge to `preview.length`
  // (it would read 6 or 4) or drops the slice cap (it would fan 6 posters).
  it("fans exactly 4 posters and shows the server count, not the preview length", () => {
    const preview = Array.from({ length: 6 }, (_, i) =>
      item({ id: `movie:${i}`, title: `Part ${i}`, poster: `https://img/${i}.jpg` }),
    );
    const collection: LibraryCollection = {
      id: "collection:10",
      title: "The Saga",
      count: 7,
      preview,
    };
    const { container } = render(
      <CollectionsLens
        collections={[collection]}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn(async () => undefined)}
      />,
    );

    // The fan renders each poster as an `<img>` (alt="" — decorative). Six
    // preview items, but only four make it onto the card.
    const posters = container.querySelectorAll("img");
    expect(posters).toHaveLength(4);

    // Badge reads the server total (7 titles), never the preview length (6) or
    // the capped fan size (4).
    expect(screen.getByText("7 titles")).toBeTruthy();
    expect(screen.queryByText("6 titles")).toBeNull();
    expect(screen.queryByText("4 titles")).toBeNull();
  });
});

describe("AzLens rail", () => {
  // The rail is driven by the whole-library `letters` facet, NOT the loaded
  // entries: a facet letter links even before its section has scrolled into the
  // infinite stream, and a letter absent from the facet renders inert. Here only
  // an "A" section is loaded but the facet lists A and C — so both must be live
  // jump buttons while B (absent from the facet) is an aria-hidden span.
  it("renders facet letters as jump buttons and absent letters inert", () => {
    const entries = toSectionEntries([item({ id: "1", title: "Apple" })], "az");
    render(
      <AzLens
        letters={["A", "C"]}
        entries={entries}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn(async () => undefined)}
      />,
    );
    const rail = screen.getByRole("navigation", { name: "Jump to letter" });

    // A and C are live buttons (facet-driven) even though only A is loaded.
    expect(within(rail).getByRole("button", { name: "Jump to A" })).toBeTruthy();
    expect(within(rail).getByRole("button", { name: "Jump to C" })).toBeTruthy();
    // B is absent from the facet → inert: no button, and rendered aria-hidden.
    expect(within(rail).queryByRole("button", { name: "Jump to B" })).toBeNull();
    const bGlyph = within(rail)
      .getAllByText("B")
      .find((el) => el.getAttribute("aria-hidden") === "true");
    expect(bGlyph).toBeTruthy();
  });
});

describe("TimelineLens rail + yearless label", () => {
  // The decade rail is built from the `decades` facet (numeric, newest-first),
  // and the yearless bucket — which has no decade button — must still localize
  // its header through `timelineSectionLabel`/`m.library_timeline_unknown`, NOT
  // leak the raw "unknown" section key. This guards the render-boundary seam:
  // section-groups stays locale-free, the lens localizes.
  it("renders decade buttons from facets and resolves the yearless header label", () => {
    const entries = toSectionEntries(
      [
        item({ id: "1", title: "New", year: 2021 }),
        item({ id: "2", title: "Yearless", year: undefined }),
      ],
      "timeline",
    );
    render(
      <TimelineLens
        decades={[2020]}
        entries={entries}
        hasNextPage={false}
        isFetchingNextPage={false}
        fetchNextPage={vi.fn(async () => undefined)}
      />,
    );
    const rail = screen.getByRole("navigation", { name: "Jump to decade" });
    // The 2020 decade is present in the loaded stream → a live jump button whose
    // aria-label localizes via timelineSectionLabel ("2020s").
    expect(within(rail).getByRole("button", { name: "Jump to 2020s" })).toBeTruthy();

    // The yearless section header reads the localized label, never the raw key.
    expect(screen.getByText("Unknown year")).toBeTruthy();
    expect(screen.queryByText("unknown")).toBeNull();
  });
});

describe("LibraryCard quality chips", () => {
  // The footer caps quality chips at MAX_TAGS (3) so it stays tidy; a fourth tag
  // must be dropped. And when `tags` is undefined the chip container must not
  // render at all (no empty wrapper), so the migration-era mock that left tags
  // unset shows nothing rather than an empty strip.
  it("renders at most three chips and drops the overflow", () => {
    const { container } = render(
      <LibraryCard
        item={item({ id: "movie:1", title: "Dune", tags: ["4K HDR", "Atmos", "HDR10", "DV"] })}
      />,
    );
    expect(screen.getByText("4K HDR")).toBeTruthy();
    expect(screen.getByText("Atmos")).toBeTruthy();
    expect(screen.getByText("HDR10")).toBeTruthy();
    // The fourth tag is over the cap and must not render.
    expect(screen.queryByText("DV")).toBeNull();
    // The chip wrapper holds exactly three chip spans.
    const wrapper = container.querySelector(".flex-wrap");
    expect(wrapper).toBeTruthy();
    expect(wrapper!.children).toHaveLength(3);
  });

  it("renders no chip container when tags are undefined", () => {
    const { container } = render(<LibraryCard item={item({ id: "movie:2", title: "Arrival" })} />);
    expect(container.querySelector(".flex-wrap")).toBeNull();
  });
});
