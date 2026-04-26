// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusPill } from "../status-pill";

afterEach(() => cleanup());

describe("StatusPill", () => {
  it("includes a screen-reader label and visible copy", () => {
    render(<StatusPill status="requested" />);
    expect(screen.getByText("Status:")).toBeTruthy();
    expect(screen.getByText("Requested")).toBeTruthy();
  });

  it("renders distinct copy per status", () => {
    const cases = [
      ["available", "Available"],
      ["processing", "Processing"],
      ["unavailable", "Unavailable"],
    ] as const;
    for (const [status, copy] of cases) {
      const { unmount } = render(<StatusPill status={status} />);
      expect(screen.getByText(copy)).toBeTruthy();
      unmount();
    }
  });
});
