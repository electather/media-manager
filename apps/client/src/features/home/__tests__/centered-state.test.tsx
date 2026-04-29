// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CenteredState } from "../components/centered-state";

afterEach(() => cleanup());

describe("CenteredState", () => {
  it("renders title and body", () => {
    render(<CenteredState title="Hello" body="World" />);
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("World")).toBeTruthy();
  });

  it("renders action button when descriptor passed", async () => {
    const onClick = vi.fn();
    render(<CenteredState title="T" body="B" action={{ label: "Press", onClick }} />);
    const btn = screen.getByRole("button", { name: "Press" });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
