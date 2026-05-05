// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Card } from "../components/card/index";
import type { HomeMediaItem, RowKind } from "../lib/types";

afterEach(() => cleanup());

/** Builds a minimal HomeMediaItem for use in tests. */
function makeItem(overrides: Partial<HomeMediaItem> = {}): HomeMediaItem {
  return {
    id: "movie:test-1",
    tmdbId: "test-1",
    mediaType: "movie",
    title: "Test Movie",
    year: 2024,
    poster: "https://example.com/poster.jpg",
    backdrop: "https://example.com/backdrop.jpg",
    genres: ["Drama"],
    rating: 7.5,
    ...overrides,
  };
}

describe("Card", () => {
  it("renders with aspect-video class when rowKind maps to 16/9", () => {
    const item = makeItem();
    const { container } = render(<Card item={item} rowKind="continueWatching" />);
    expect(container.querySelector(".aspect-video")).toBeTruthy();
  });

  it("renders with aspect-[2/3] class when rowKind maps to 2/3", () => {
    const item = makeItem();
    const { container } = render(<Card item={item} rowKind="recommendedForYou" />);
    expect(container.querySelector('[class*="aspect-\\[2\\/3\\]"]')).toBeTruthy();
  });

  it("renders a progress bar when item.progress is set", () => {
    const item = makeItem({ progress: { watched: 30, total: 100 } });
    render(<Card item={item} rowKind="continueWatching" />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("does not render a progress bar when item.progress is absent", () => {
    const item = makeItem({ progress: undefined });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows available badge when availability has a server copy", () => {
    const item = makeItem({
      availability: {
        hasAnyServerCopy: true,
        requestEligible: false,
        servers: [{ id: "plex", label: "Plex" }],
      },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText(/available/i)).toBeTruthy();
  });

  it("shows requested badge when requestEligible is false and no server copy", () => {
    const item = makeItem({
      availability: { hasAnyServerCopy: false, requestEligible: false, servers: [] },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText(/requested/i)).toBeTruthy();
  });

  it("shows unavailable badge when requestEligible is true and no server copy", () => {
    const item = makeItem({
      availability: { hasAnyServerCopy: false, requestEligible: true, servers: [] },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    // The Request button is rendered alongside the unavailable badge.
    expect(screen.getByText(/unavailable/i)).toBeTruthy();
  });

  it("renders the match reason chip when matchReasonKey is set", () => {
    const item = makeItem({
      matchReasonKey: "highly_rated",
      matchReasonParams: {},
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText(/highly rated/i)).toBeTruthy();
  });

  it("does not render a match reason chip when matchReasonKey is absent", () => {
    const item = makeItem({ matchReasonKey: undefined });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.queryByText(/highly rated/i)).toBeNull();
  });

  it("renders the Request button with an aria-label containing the item title", () => {
    const item = makeItem({
      availability: { hasAnyServerCopy: false, requestEligible: true, servers: [] },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    const btn = screen.getByRole("button", { name: /request.*test movie/i });
    expect(btn).toBeTruthy();
  });

  it("renders the watchlist button with an aria-label containing the item title", () => {
    const item = makeItem();
    render(<Card item={item} rowKind="recommendedForYou" />);
    const btn = screen.getByRole("button", { name: /watchlist.*test movie/i });
    expect(btn).toBeTruthy();
  });

  it("renders an img with alt text equal to the item title", () => {
    const item = makeItem({ poster: "https://example.com/poster.jpg" });
    render(<Card item={item} rowKind="recommendedForYou" />);
    const img = screen.getByAltText("Test Movie");
    expect(img).toBeTruthy();
  });
});

describe("Card (16/9 row kinds)", () => {
  const sixteenNineKinds: RowKind[] = ["continueWatching", "upcomingForYou"];

  for (const kind of sixteenNineKinds) {
    it(`uses backdrop image for rowKind=${kind}`, () => {
      const item = makeItem({
        backdrop: "https://example.com/backdrop.jpg",
        poster: "https://example.com/poster.jpg",
      });
      render(<Card item={item} rowKind={kind} />);
      const img = screen.getByAltText("Test Movie") as HTMLImageElement;
      expect(img.src).toContain("backdrop.jpg");
    });
  }
});

describe("Card (2/3 row kinds)", () => {
  const twoThreeKinds: RowKind[] = [
    "recommendedForYou",
    "becauseYouWatched",
    "trendingNow",
    "newReleases",
    "yourWatchlist",
  ];

  for (const kind of twoThreeKinds) {
    it(`uses poster image for rowKind=${kind}`, () => {
      const item = makeItem({
        backdrop: "https://example.com/backdrop.jpg",
        poster: "https://example.com/poster.jpg",
      });
      render(<Card item={item} rowKind={kind} />);
      const img = screen.getByAltText("Test Movie") as HTMLImageElement;
      expect(img.src).toContain("poster.jpg");
    });
  }
});
