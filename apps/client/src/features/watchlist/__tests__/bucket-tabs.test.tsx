// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());

let pathname = "/watchlist/ready";
let search: Record<string, string> = {};

interface LinkActiveOptions {
  exact?: boolean;
  includeSearch?: boolean;
}

vi.mock("@tanstack/react-router", () => ({
  // `RouteTab` wraps its anchor with `createLink`; mimic the TanStack active
  // derivation it relies on. `includeSearch: false` (RouteTab's default) means
  // a `?sort=` flip must NOT drop the active mark (V.WL9) — only the pathname
  // decides the match.
  createLink:
    (Base: React.ComponentType<Record<string, unknown>>) =>
    ({ to, activeOptions, activeProps, ...rest }: Record<string, unknown>) => {
      const includeSearch = (activeOptions as LinkActiveOptions | undefined)?.includeSearch ?? true;
      const isActive = pathname === to && (includeSearch ? Object.keys(search).length === 0 : true);
      const active = (isActive ? (activeProps as Record<string, unknown>) : null) ?? {};
      return (
        <Base href={to} data-status={isActive ? "active" : "inactive"} {...rest} {...active} />
      );
    },
}));

const { BucketTabs } = await import("../components/sections/all-items/bucket-tabs");

describe("BucketTabs — V.WL9 active state derives from pathname only", () => {
  it("marks the matching bucket tab active when no search params are present", () => {
    pathname = "/watchlist/ready";
    search = {};
    render(<BucketTabs />);
    const tab = screen.getByRole("tab", { name: /Ready/i });
    expect(tab.getAttribute("data-status")).toBe("active");
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the tab active when `?sort=alpha` is appended to the URL", () => {
    pathname = "/watchlist/ready";
    search = { sort: "alpha" };
    render(<BucketTabs />);
    const tab = screen.getByRole("tab", { name: /Ready/i });
    // V.WL9 — sort flip ⊥ kill active. Regression would surface as
    // `data-status="inactive"` here because the default TanStack
    // `includeSearch` is true.
    expect(tab.getAttribute("data-status")).toBe("active");
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("renders a tab for every bucket including the rev-6 `unavailable` entry", () => {
    pathname = "/watchlist";
    search = {};
    render(<BucketTabs />);
    expect(screen.getByRole("tab", { name: /Unavailable/i })).toBeDefined();
  });
});
