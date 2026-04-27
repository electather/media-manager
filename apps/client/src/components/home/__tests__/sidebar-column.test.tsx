// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { HomeRow } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: () => ({ data: undefined }),
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

import { SidebarColumn } from "../sidebar-column";

const row: HomeRow = {
  rowId: "upcomingForYou",
  title: "Upcoming",
  items: [
    {
      id: "tv:1",
      tmdbId: "1",
      mediaType: "tv",
      title: "Show A",
      backdrop: "a.jpg",
      episode: { season: 1, episode: 2, airsAt: Date.UTC(2026, 4, 1) },
    },
    {
      id: "tv:2",
      tmdbId: "2",
      mediaType: "tv",
      title: "Show B",
      backdrop: "b.jpg",
      episode: { season: 2, episode: 3, airsAt: Date.UTC(2026, 4, 2) },
    },
  ],
  cursor: null,
};

afterEach(() => cleanup());

describe("SidebarColumn", () => {
  it("renders titleOverride when present, otherwise the row title", () => {
    render(<SidebarColumn row={{ ...row, titleOverride: "Up next" }} />);
    expect(screen.getByTestId("sidebar-title").textContent).toBe("Up next");
    cleanup();
    render(<SidebarColumn row={row} />);
    expect(screen.getByTestId("sidebar-title").textContent).toBe("Upcoming");
  });

  it("renders one SidebarItem per row item", () => {
    render(<SidebarColumn row={row} />);
    const list = screen.getByTestId("sidebar-list");
    const items = within(list).getAllByTestId("sidebar-item");
    expect(items.length).toBe(row.items.length);
  });

  it("declares the horizontal-scroll layout as the default (sub-md container width)", () => {
    // Below the @[768px] breakpoint the design doc requires a horizontal-
    // scroll backdrop row. Tailwind container queries don't actually
    // resolve in happy-dom, so we assert the class names that drive the
    // layout are present and the scaffold is correct.
    render(<SidebarColumn row={row} />);
    const list = screen.getByTestId("sidebar-list");
    const className = list.className;
    expect(className).toContain("flex");
    expect(className).toContain("overflow-x-auto");
    // Each slide carries the fixed width that makes horizontal scroll
    // sensible without items shrinking to 0.
    const slides = within(list).getAllByTestId("sidebar-item");
    slides.forEach((item) => {
      // Slides are wrapped in a width-fixing div directly above the link.
      const slide = item.parentElement!;
      expect(slide.className).toContain("w-[280px]");
      expect(slide.className).toContain("shrink-0");
    });
  });

  it("declares the vertical-list override at the @[768px] breakpoint", () => {
    render(<SidebarColumn row={row} />);
    const list = screen.getByTestId("sidebar-list");
    const className = list.className;
    expect(className).toContain("@[768px]:flex-col");
    expect(className).toContain("@[768px]:overflow-visible");
    const items = within(list).getAllByTestId("sidebar-item");
    items.forEach((item) => {
      expect(item.parentElement!.className).toContain("@[768px]:w-auto");
    });
  });
});
