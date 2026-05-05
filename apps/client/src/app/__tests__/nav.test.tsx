// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mockPathname = vi.hoisted(() => ({ value: "/" }));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: mockPathname.value } }),
    Link: ({
      to,
      children,
      activeOptions,
      activeProps,
      ...props
    }: {
      to: string;
      children?: React.ReactNode;
      activeOptions?: { exact?: boolean };
      activeProps?: Record<string, unknown>;
    } & React.ComponentProps<"a">) => {
      const isActive = activeOptions?.exact
        ? mockPathname.value === to
        : mockPathname.value.startsWith(to);
      return (
        <a href={to} {...props} {...(isActive ? activeProps : {})}>
          {children}
        </a>
      );
    },
  };
});

afterEach(() => {
  cleanup();
  mockPathname.value = "/";
});

import { BottomNav } from "../bottom-nav";
import { TopNavLinks } from "../top-nav-links";

describe("TopNavLinks", () => {
  it("renders Home, Library and Watchlist links", () => {
    render(<TopNavLinks />);
    expect(screen.getByRole("link", { name: /home/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /library/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /watchlist/i })).toBeTruthy();
  });

  it("marks the active route with aria-current=page", () => {
    mockPathname.value = "/library";
    render(<TopNavLinks />);
    expect(screen.getByRole("link", { name: /library/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: /home/i }).getAttribute("aria-current")).toBeNull();
  });

  it("all links are keyboard-reachable (tabIndex not -1)", () => {
    render(<TopNavLinks />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("has a unique accessible label distinct from mobile nav", () => {
    render(<TopNavLinks />);
    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBeTruthy();
    expect(nav.getAttribute("aria-label")).not.toBe("Mobile navigation");
  });

  it("keeps the desktop links visually readable without a per-link surface", () => {
    render(<TopNavLinks />);
    const nav = screen.getByRole("navigation");
    const library = screen.getByRole("link", { name: /library/i });

    expect(nav.className).not.toContain("before:bg-[linear-gradient");
    expect(library.className).toContain("text-foreground/75");
    expect(library.className).toContain("drop-shadow-");
  });
});

describe("BottomNav", () => {
  it("renders Home, Library and Watchlist links", () => {
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /home/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /library/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /watchlist/i })).toBeTruthy();
  });

  it("marks the active route with aria-current=page", () => {
    mockPathname.value = "/watchlist";
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /watchlist/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: /library/i }).getAttribute("aria-current")).toBeNull();
  });

  it("all links are keyboard-reachable (tabIndex not -1)", () => {
    render(<BottomNav />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  it("has a unique accessible label distinct from desktop nav", () => {
    render(<BottomNav />);
    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBeTruthy();
    expect(nav.getAttribute("aria-label")).not.toBe("Main navigation");
  });

  it("does not show active pill on unmatched routes", () => {
    mockPathname.value = "/settings";
    const { container } = render(<BottomNav />);
    expect(container.querySelector('[data-testid="nav-active-pill"]')).toBeNull();
  });
});
