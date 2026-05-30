// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { GridSkeleton } from "../grid-skeleton";

afterEach(() => cleanup());

describe("GridSkeleton", () => {
  it("renders 12 poster-shaped placeholders by default", () => {
    const { container } = render(<GridSkeleton />);
    expect(container.querySelectorAll(".aspect-\\[2\\/3\\]")).toHaveLength(12);
  });

  it("renders a custom count", () => {
    const { container } = render(<GridSkeleton count={5} />);
    expect(container.querySelectorAll(".aspect-\\[2\\/3\\]")).toHaveLength(5);
  });

  it("varies the shape by the aspect prop", () => {
    const { container } = render(<GridSkeleton aspect="16/9" count={3} />);
    expect(container.querySelectorAll(".aspect-video")).toHaveLength(3);
    expect(container.querySelectorAll(".aspect-\\[2\\/3\\]")).toHaveLength(0);
  });

  it("sets a responsive column template at the given min width", () => {
    render(<GridSkeleton minColumnWidthPx={220} />);
    const wrapper = screen.getByTestId("grid-skeleton");
    expect(wrapper.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(220px, 1fr))");
  });
});
