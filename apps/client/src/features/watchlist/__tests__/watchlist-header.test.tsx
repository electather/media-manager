// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

let pathname = "/watchlist";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    "aria-selected": ariaSelected,
    activeOptions: _activeOptions,
    activeProps,
    inactiveProps,
    role,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    "aria-selected"?: string;
    activeOptions?: unknown;
    activeProps?: Record<string, string>;
    inactiveProps?: Record<string, string>;
    role?: string;
    className?: string;
  }) => {
    const isActive = pathname === to;
    const props = isActive ? activeProps : inactiveProps;
    const ariaSel = (props?.["aria-selected"] ?? ariaSelected) as "true" | "false" | undefined;
    return (
      <a
        href={to}
        data-status={isActive ? "active" : "inactive"}
        role={role}
        aria-selected={ariaSel}
        className={className}
      >
        {children}
      </a>
    );
  },
  useLocation: () => ({ pathname }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

const { WatchlistHeader } = await import("../components/watchlist-header");

const COUNTS = { ready: 3, inProgress: 1, awaiting: 1, upcoming: 2, total: 7 } as const;

describe("WatchlistHeader (V.WL8)", () => {
  it("always renders the chip strip including the in-progress chip", () => {
    pathname = "/watchlist";
    render(<WatchlistHeader counts={COUNTS} />);
    expect(screen.getByRole("tab", { name: /All/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /In progress/i })).toBeDefined();
  });

  it("hides the sort dropdown on the curated index route", () => {
    pathname = "/watchlist";
    render(<WatchlistHeader counts={COUNTS} />);
    expect(screen.queryByRole("combobox", { name: /sort/i })).toBeNull();
  });

  it("surfaces the sort dropdown on a flat bucket sub-route", () => {
    pathname = "/watchlist/ready";
    render(<WatchlistHeader counts={COUNTS} />);
    expect(screen.getByRole("combobox", { name: /sort/i })).toBeDefined();
  });

  it("marks the chip that matches the current pathname as the active tab", () => {
    pathname = "/watchlist/in-progress";
    render(<WatchlistHeader counts={COUNTS} />);
    const chip = screen.getByRole("tab", { name: /In progress/i });
    expect(chip.getAttribute("data-status")).toBe("active");
  });
});
