// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { CenteredState } from "../centered-state";

afterEach(() => cleanup());

describe("CenteredState", () => {
  it("renders title, body, and optional action", () => {
    render(
      <CenteredState
        title="Empty"
        body="Nothing yet."
        action={<button type="button">Do thing</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Empty" })).toBeTruthy();
    expect(screen.getByText("Nothing yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Do thing" })).toBeTruthy();
  });

  it("works without an action", () => {
    render(<CenteredState title="No action" body="body" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
