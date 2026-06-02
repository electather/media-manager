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
  createLink:
    (Base: React.ComponentType<Record<string, unknown>>) =>
    ({ to, activeOptions: _activeOptions, activeProps, ...rest }: Record<string, unknown>) => {
      const isActive = pathname === to;
      const active = (isActive ? (activeProps as Record<string, unknown>) : null) ?? {};
      return (
        <Base href={to} data-status={isActive ? "active" : "inactive"} {...rest} {...active} />
      );
    },
  useLocation: () => ({ pathname }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

vi.mock("../hooks/use-moods", () => ({
  useMoods: () => ({
    data: {
      clusters: [
        { moodId: "epic", count: 12 },
        { moodId: "dark", count: 7 },
      ],
    },
  }),
}));

const { WatchlistHeader } = await import("../components/watchlist-header");

describe("WatchlistHeader (V.WL8)", () => {
  it("always renders the chip strip including the in-progress chip", () => {
    pathname = "/watchlist";
    render(<WatchlistHeader />);
    expect(screen.getByRole("link", { name: /All/i })).toBeDefined();
    expect(screen.getByRole("link", { name: /In progress/i })).toBeDefined();
  });

  it("hides the sort dropdown on the curated index route", () => {
    pathname = "/watchlist";
    render(<WatchlistHeader />);
    expect(screen.queryByRole("combobox", { name: /sort/i })).toBeNull();
  });

  it("surfaces the sort dropdown on a flat bucket sub-route", () => {
    pathname = "/watchlist/ready";
    render(<WatchlistHeader />);
    expect(screen.getByRole("combobox", { name: /sort/i })).toBeDefined();
  });

  it("marks the chip that matches the current pathname as the active tab", () => {
    pathname = "/watchlist/in-progress";
    render(<WatchlistHeader />);
    const chip = screen.getByRole("link", { name: /In progress/i });
    expect(chip.getAttribute("data-status")).toBe("active");
  });

  describe("mood detail route", () => {
    it("renders the breadcrumb instead of the chip strip + sort dropdown", () => {
      pathname = "/watchlist/moods/epic";
      render(<WatchlistHeader />);
      // Chip strip and sort do not compose with a mood-scoped grid.
      expect(screen.queryByRole("link", { name: /All/i })).toBeNull();
      expect(screen.queryByRole("combobox", { name: /sort/i })).toBeNull();
      const crumb = screen.getByRole("navigation", { name: /breadcrumb/i });
      expect(crumb).toBeDefined();
      const root = screen.getByRole("link", { name: /Watchlist/i });
      expect(root.getAttribute("href")).toBe("/watchlist");
    });

    it("renders the mood label as the H1 and the mood note as the subtitle", () => {
      pathname = "/watchlist/moods/epic";
      render(<WatchlistHeader />);
      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading.textContent).toMatch(/Epic/i);
    });

    it("renders the cluster count next to the title", () => {
      pathname = "/watchlist/moods/epic";
      render(<WatchlistHeader />);
      const heading = screen.getByRole("heading", { level: 1 });
      // SectionHeadCount zero-pads, so "12" remains "12".
      expect(heading.textContent).toMatch(/12/);
    });

    it("falls back to the default header when the mood id is unknown", () => {
      pathname = "/watchlist/moods/not-a-mood";
      render(<WatchlistHeader />);
      expect(screen.getByRole("link", { name: /All/i })).toBeDefined();
      expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).toBeNull();
    });
  });
});
