// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

import { ProgressBar } from "../components/progress-bar";

afterEach(() => cleanup());

describe("ProgressBar", () => {
  it("renders width matching ratio", () => {
    render(<ProgressBar watched={30} total={120} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
  });

  it("clamps overflowing ratio to 100", () => {
    render(<ProgressBar watched={500} total={100} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("returns null on zero total", () => {
    const { container } = render(<ProgressBar watched={0} total={0} />);
    expect(container.firstChild).toBeNull();
  });
});
