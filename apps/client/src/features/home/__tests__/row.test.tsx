// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Row } from "../components/row/index";
import type { HomeMediaItem, RowData } from "../lib/types";

afterEach(() => cleanup());

/** Builds a minimal HomeMediaItem for use in row tests. */
function makeItem(id: string, overrides: Partial<HomeMediaItem> = {}): HomeMediaItem {
  return {
    id,
    tmdbId: id,
    mediaType: "movie",
    title: `Movie ${id}`,
    year: 2024,
    poster: `https://example.com/${id}.jpg`,
    backdrop: `https://example.com/${id}-bd.jpg`,
    genres: ["Drama"],
    rating: 7.5,
    ...overrides,
  };
}

/** Builds a RowData with sensible defaults. */
function makeRow(overrides: Partial<RowData> = {}): RowData {
  return {
    id: "recommendedForYou",
    kind: "recommendedForYou",
    defaultAspect: "2/3",
    items: [makeItem("a"), makeItem("b"), makeItem("c")],
    ...overrides,
  };
}

describe("Row", () => {
  it("renders all items present in row.items", () => {
    const row = makeRow({
      items: [makeItem("x"), makeItem("y"), makeItem("z")],
    });
    render(<Row row={row} />);
    expect(screen.getByText("Movie x")).toBeTruthy();
    expect(screen.getByText("Movie y")).toBeTruthy();
    expect(screen.getByText("Movie z")).toBeTruthy();
  });

  it("renders skeleton placeholder cards when row.items is empty", () => {
    const row = makeRow({ items: [] });
    const { container } = render(<Row row={row} />);
    // Skeleton elements carry the data-slot attribute set by the Skeleton component.
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows a partial warning indicator when row.partial is true", () => {
    const row = makeRow({ partial: true });
    render(<Row row={row} />);
    expect(screen.getByTestId("partial-warning")).toBeTruthy();
  });

  it("does not show a partial warning when row.partial is false", () => {
    const row = makeRow({ partial: false });
    render(<Row row={row} />);
    expect(screen.queryByTestId("partial-warning")).toBeNull();
  });

  it("renders a visible heading for the row", () => {
    const row = makeRow({ kind: "trendingNow", defaultAspect: "2/3" });
    render(<Row row={row} />);
    // The heading text is driven by the i18n key; look for a heading element.
    const heading = screen.getByRole("heading");
    expect(heading).toBeTruthy();
    expect(heading.textContent?.length).toBeGreaterThan(0);
  });

  it("renders a subtitle when the row kind has one", () => {
    const row = makeRow({
      kind: "becauseYouWatched",
      defaultAspect: "2/3",
      seedTitle: "Helios Run",
    });
    render(<Row row={row} />);
    // The subtitle text is sourced from the i18n key home_row_becauseYouWatched_subtitle.
    expect(screen.getByText(/themed picks/i)).toBeTruthy();
  });

  it("does not show a partial warning indicator when partial is absent", () => {
    const row = makeRow({ partial: undefined });
    render(<Row row={row} />);
    expect(screen.queryByTestId("partial-warning")).toBeNull();
  });
});
