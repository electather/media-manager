// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

import { WatchlistGridSkeleton } from "../components/sections/all-items/grid-skeleton";

afterEach(() => cleanup());

describe("WatchlistGridSkeleton (V.WL10)", () => {
  it("renders 12 card-shaped placeholders by default", () => {
    const { container } = render(<WatchlistGridSkeleton />);
    const placeholders = container.querySelectorAll(".aspect-\\[2\\/3\\]");
    expect(placeholders).toHaveLength(12);
  });

  it("renders rows*cols placeholders for custom dimensions", () => {
    const { container } = render(<WatchlistGridSkeleton rows={2} cols={5} />);
    const placeholders = container.querySelectorAll(".aspect-\\[2\\/3\\]");
    expect(placeholders).toHaveLength(10);
  });

  it("sets a responsive grid column template at minColumnWidthPx=180", () => {
    render(<WatchlistGridSkeleton />);
    const wrapper = screen.getByTestId("watchlist-grid-skeleton");
    expect(wrapper.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(180px, 1fr))");
  });
});
