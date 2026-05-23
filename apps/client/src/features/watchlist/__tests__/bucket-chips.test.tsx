// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { WatchlistCounts } from "@ent-mcp/shared/watchlist";

afterEach(() => cleanup());

let pathname = "/watchlist/ready";
let search: Record<string, string> = {};

interface LinkActiveOptions {
  exact?: boolean;
  includeSearch?: boolean;
}

interface MockLinkProps {
  to: string;
  children: React.ReactNode;
  activeOptions?: LinkActiveOptions;
  activeProps?: Record<string, string>;
  inactiveProps?: Record<string, string>;
  role?: string;
  className?: string;
}

vi.mock("@tanstack/react-router", () => ({
  // Mimic the TanStack `<Link>` active-state derivation: when
  // `includeSearch` is true (the library default), the active match also
  // requires the current search params to be a subset of the link's. When
  // it's explicitly false (rev 6, V.WL9), only the pathname matters.
  Link: ({
    to,
    children,
    activeOptions,
    activeProps,
    inactiveProps,
    role,
    className,
  }: MockLinkProps) => {
    const includeSearch = activeOptions?.includeSearch ?? true;
    const pathMatch = pathname === to;
    const searchMatch = includeSearch ? Object.keys(search).length === 0 : true;
    const isActive = pathMatch && searchMatch;
    const props = isActive ? activeProps : inactiveProps;
    const ariaSelected = props?.["aria-selected"] as "true" | "false" | undefined;
    return (
      <a
        href={to}
        role={role}
        data-status={isActive ? "active" : "inactive"}
        aria-selected={ariaSelected}
        className={className}
      >
        {children}
      </a>
    );
  },
}));

const { BucketChips } = await import("../components/sections/all-items/bucket-chips");

const COUNTS: WatchlistCounts = {
  ready: 3,
  inProgress: 1,
  awaiting: 1,
  unavailable: 2,
  upcoming: 1,
  total: 8,
};

describe("BucketChips — V.WL9 active state derives from pathname only", () => {
  it("marks the matching bucket chip active when no search params are present", () => {
    pathname = "/watchlist/ready";
    search = {};
    render(<BucketChips counts={COUNTS} />);
    const chip = screen.getByRole("tab", { name: /Ready/i });
    expect(chip.getAttribute("data-status")).toBe("active");
    expect(chip.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the chip active when `?sort=alpha` is appended to the URL", () => {
    pathname = "/watchlist/ready";
    search = { sort: "alpha" };
    render(<BucketChips counts={COUNTS} />);
    const chip = screen.getByRole("tab", { name: /Ready/i });
    // V.WL9 — sort flip ⊥ kill active. Regression would surface as
    // `data-status="inactive"` here because the default TanStack
    // `includeSearch` is true.
    expect(chip.getAttribute("data-status")).toBe("active");
    expect(chip.getAttribute("aria-selected")).toBe("true");
  });

  it("renders a chip for every bucket including the rev-6 `unavailable` entry", () => {
    pathname = "/watchlist";
    search = {};
    render(<BucketChips counts={COUNTS} />);
    expect(screen.getByRole("tab", { name: /Unavailable/i })).toBeDefined();
  });
});
