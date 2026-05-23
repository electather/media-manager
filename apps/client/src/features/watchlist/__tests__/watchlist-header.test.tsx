// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

afterEach(() => cleanup());

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const { WatchlistHeader } = await import("../components/watchlist-header");

const COUNTS = { ready: 3, inProgress: 0, awaiting: 1, upcoming: 2, total: 6 } as const;

describe("WatchlistHeader (V.WL6)", () => {
  it("renders the View all link in curated mode and navigates on click", async () => {
    navigateMock.mockClear();
    render(<WatchlistHeader mode="curated" counts={COUNTS} />);
    const link = screen.getByRole("button", { name: /view all/i });
    await userEvent.click(link);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/watchlist/all" });
  });

  it("hides the View all link in flat mode and surfaces the sort dropdown", () => {
    render(<WatchlistHeader mode="flat" counts={COUNTS} sort="alpha" />);
    expect(screen.queryByRole("button", { name: /view all/i })).toBeNull();
    expect(screen.getByRole("combobox", { name: /sort/i })).toBeDefined();
  });
});
