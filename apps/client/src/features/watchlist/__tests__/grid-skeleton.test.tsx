// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

import { GridSkeleton } from "@/shared/components/grid-skeleton";

afterEach(() => cleanup());

describe("GridSkeleton (V.WL10)", () => {
  it("renders 12 card-shaped placeholders by default", () => {
    const { container } = render(<GridSkeleton />);
    const placeholders = container.querySelectorAll(".aspect-\\[2\\/3\\]");
    expect(placeholders).toHaveLength(12);
  });

  it("renders count placeholders for a custom count", () => {
    const { container } = render(<GridSkeleton count={10} />);
    const placeholders = container.querySelectorAll(".aspect-\\[2\\/3\\]");
    expect(placeholders).toHaveLength(10);
  });

  it("sets a responsive grid column template at the default minColumnWidthPx=180", () => {
    render(<GridSkeleton minColumnWidthPx={180} />);
    const wrapper = screen.getByTestId("grid-skeleton");
    expect(wrapper.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(180px, 1fr))");
  });
});
