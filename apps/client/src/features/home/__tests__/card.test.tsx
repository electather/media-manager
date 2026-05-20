// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Card } from "../components/card/index";
import type { HomeMediaItem, RowKind } from "../lib/types";

afterEach(() => cleanup());

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
    const { container } = render(<Card item={makeItem()} rowKind="continueWatching" />);
    expect(container.querySelector(".aspect-video")).toBeTruthy();
  });

  it("renders with aspect-[2/3] class when rowKind maps to 2/3", () => {
    const { container } = render(<Card item={makeItem()} rowKind="recommendedForYou" />);
    expect(container.querySelector('[class*="aspect-\\[2\\/3\\]"]')).toBeTruthy();
  });

  it("renders a progress bar when item.progress is set", () => {
    const item = makeItem({ progress: { watched: 30, total: 100 } });
    render(<Card item={item} rowKind="continueWatching" />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("does not render a progress bar when item.progress is absent", () => {
    render(<Card item={makeItem({ progress: undefined })} rowKind="recommendedForYou" />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows server label when availability has a single server copy", () => {
    const item = makeItem({
      availability: {
        hasAnyServerCopy: true,
        requestEligible: false,
        servers: [{ id: "plex", label: "Plex" }],
      },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText("Plex")).toBeTruthy();
  });

  it("shows servers count when availability has multiple server copies", () => {
    const item = makeItem({
      availability: {
        hasAnyServerCopy: true,
        requestEligible: false,
        servers: [
          { id: "plex", label: "Plex" },
          { id: "jellyfin", label: "Jellyfin" },
        ],
      },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText(/2\s*servers/i)).toBeTruthy();
  });

  it("shows requested badge when status is requested", () => {
    const item = makeItem({
      status: "requested",
      availability: { hasAnyServerCopy: false, requestEligible: false, servers: [] },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText(/requested/i)).toBeTruthy();
  });

  it("shows request badge when requestEligible is true and no server copy", () => {
    const item = makeItem({
      availability: { hasAnyServerCopy: false, requestEligible: true, servers: [] },
    });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText(/^request$/i)).toBeTruthy();
  });

  it("renders the match reason chip when matchReason is set", () => {
    const item = makeItem({ matchReason: { key: "highly_rated", params: {} } });
    render(<Card item={item} rowKind="recommendedForYou" />);
    expect(screen.getByText(/highly rated/i)).toBeTruthy();
  });

  it("does not render a match reason chip when matchReason is absent", () => {
    render(<Card item={makeItem({ matchReason: undefined })} rowKind="recommendedForYou" />);
    expect(screen.queryByText(/highly rated/i)).toBeNull();
  });

  it("renders the watchlist quick-action with an aria-label containing the item title", () => {
    render(<Card item={makeItem()} rowKind="recommendedForYou" />);
    const btn = screen.getByRole("button", { name: /watchlist.*test movie/i });
    expect(btn).toBeTruthy();
  });

  it("renders an img with alt text equal to the item title", () => {
    render(<Card item={makeItem()} rowKind="recommendedForYou" />);
    expect(screen.getByAltText("Test Movie")).toBeTruthy();
  });

  it("calls onClick when the card click overlay is activated", () => {
    const onClick = vi.fn();
    render(<Card item={makeItem()} rowKind="recommendedForYou" onClick={onClick} />);
    const overlay = screen.getByRole("link", { name: /open details for.*test movie/i });
    overlay.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("exposes the canonical detail href so cmd-click opens a new tab", () => {
    render(<Card item={makeItem()} rowKind="recommendedForYou" />);
    const overlay = screen.getByRole("link", { name: /open details for.*test movie/i });
    expect(overlay.getAttribute("href")).toBe("/media/movie/test-1");
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
