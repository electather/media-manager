// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { RowErrorBoundary } from "../row-error-boundary";

function Boom(): React.ReactElement {
  throw new Error("boom");
}

afterEach(() => cleanup());

describe("RowErrorBoundary", () => {
  it("renders nothing when a child throws", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(
      <RowErrorBoundary>
        <Boom />
      </RowErrorBoundary>,
    );
    expect(container.textContent).toBe("");
    errSpy.mockRestore();
  });

  it("renders children when nothing throws", () => {
    render(
      <RowErrorBoundary>
        <span>OK</span>
      </RowErrorBoundary>,
    );
    expect(screen.getByText("OK")).toBeTruthy();
  });
});
