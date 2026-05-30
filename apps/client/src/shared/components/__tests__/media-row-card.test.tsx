// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { MediaRowCardItem } from "../media-row-card";
import { MediaRowCard } from "../media-row-card";

const BASE: MediaRowCardItem = {
  id: "movie:1",
  tmdbId: "1",
  mediaType: "movie",
  title: "Blade Runner",
  year: 1982,
  poster: "https://img/poster.jpg",
  backdrop: "https://img/backdrop.jpg",
};

afterEach(() => cleanup());

describe("MediaRowCard", () => {
  it("renders the rail variant as 16/9 backdrop art", () => {
    render(
      <MediaRowCard
        item={BASE}
        variant="rail"
        href="/m/movie:1"
        openLabel="Open"
        kindLabel="Movie"
      />,
    );
    expect(screen.getByTestId("media-row-card").dataset.aspect).toBe("16/9");
  });

  it("renders the grid variant as 2/3 with a default title + year footer", () => {
    render(
      <MediaRowCard
        item={BASE}
        variant="grid"
        href="/m/movie:1"
        openLabel="Open"
        kindLabel="Movie"
      />,
    );
    expect(screen.getByTestId("media-row-card").dataset.aspect).toBe("2/3");
    expect(screen.getByText("Blade Runner")).toBeTruthy();
    expect(screen.getByText("1982")).toBeTruthy();
  });

  it("shows the clear-logo wordmark on the rail when the item carries one", () => {
    const { container } = render(
      <MediaRowCard
        item={{ ...BASE, clearLogo: "https://img/logo.png" }}
        variant="rail"
        href="/m/movie:1"
        openLabel="Open"
        kindLabel="Movie"
      />,
    );
    expect(container.querySelector('[data-slot="media-card-clear-logo"]')).not.toBeNull();
  });

  it("guards the clear-logo: nothing renders when the item has none (#516)", () => {
    const { container } = render(
      <MediaRowCard
        item={BASE}
        variant="rail"
        href="/m/movie:1"
        openLabel="Open"
        kindLabel="Movie"
      />,
    );
    expect(container.querySelector('[data-slot="media-card-clear-logo"]')).toBeNull();
  });

  it("never shows the clear-logo on the grid variant", () => {
    const { container } = render(
      <MediaRowCard
        item={{ ...BASE, clearLogo: "https://img/logo.png" }}
        variant="grid"
        href="/m/movie:1"
        openLabel="Open"
        kindLabel="Movie"
      />,
    );
    expect(container.querySelector('[data-slot="media-card-clear-logo"]')).toBeNull();
  });

  it("renders the action and meta slots, replacing the default footer", () => {
    render(
      <MediaRowCard
        item={BASE}
        variant="grid"
        href="/m/movie:1"
        openLabel="Open"
        kindLabel="Movie"
        action={<button data-testid="quick-action">+</button>}
        meta={<div data-testid="custom-meta">why this</div>}
      />,
    );
    expect(screen.getByTestId("quick-action")).toBeTruthy();
    expect(screen.getByTestId("custom-meta")).toBeTruthy();
    // The default title/year footer is replaced by the meta slot.
    expect(screen.queryByText("1982")).toBeNull();
  });
});
