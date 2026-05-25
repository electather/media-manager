// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { GridSkeleton } from "../grid-skeleton";

afterEach(cleanup);

describe("GridSkeleton", () => {
  it("renders 12 card-shaped placeholders with aspect-[2/3] by default", () => {
    const { container } = render(<GridSkeleton />);
    const cells = container.querySelectorAll('[data-slot="grid-skeleton-cell"]');
    expect(cells.length).toBe(12);
    for (const cell of cells) {
      expect(cell.className).toContain("aspect-[2/3]");
    }
  });

  it("varies the placeholder count via the count prop", () => {
    const { container } = render(<GridSkeleton count={4} />);
    const cells = container.querySelectorAll('[data-slot="grid-skeleton-cell"]');
    expect(cells.length).toBe(4);
  });

  it("flips to aspect-video when aspect=16/9", () => {
    const { container } = render(<GridSkeleton aspect="16/9" count={3} />);
    const root = screen.getByTestId("grid-skeleton");
    expect(root.getAttribute("data-aspect")).toBe("16/9");
    const cells = container.querySelectorAll('[data-slot="grid-skeleton-cell"]');
    expect(cells.length).toBe(3);
    for (const cell of cells) {
      expect(cell.className).toContain("aspect-video");
      expect(cell.className).not.toContain("aspect-[2/3]");
    }
  });

  it("tracks repeat(auto-fill, minmax(min, 1fr)) on the grid template", () => {
    render(<GridSkeleton minColumnWidthPx={220} gapPx={24} />);
    const root = screen.getByTestId("grid-skeleton");
    expect(root.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(220px, 1fr))");
    expect(root.style.gap).toBe("24px");
    expect(root.className).toContain("grid");
  });

  it("allows scoping via a custom testId", () => {
    render(<GridSkeleton testId="watchlist-grid-skeleton" count={2} />);
    expect(screen.getByTestId("watchlist-grid-skeleton")).toBeTruthy();
  });
});
