// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { HomeRow, LayoutHero } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: () => ({ data: undefined }),
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

import { TopZone } from "../top-zone";

afterEach(() => cleanup());

const hero: LayoutHero = {
  item: { id: "movie:550", tmdbId: "550", mediaType: "movie", title: "Fight Club", backdrop: "b" },
  source: "recommendedForYou",
  reason: "recommended",
  resumeUrl: null,
};

const sidebarRow: HomeRow = {
  rowId: "upcomingForYou",
  title: "Upcoming",
  items: [],
  cursor: null,
};

describe("TopZone composition", () => {
  it("renders both hero and sidebar when both are present", () => {
    render(<TopZone hero={hero} sidebarRow={sidebarRow} />);
    expect(screen.getByTestId("home-hero")).toBeTruthy();
    expect(screen.getByTestId("sidebar-title")).toBeTruthy();
  });

  it("renders nothing when both are absent", () => {
    const { container } = render(<TopZone hero={null} sidebarRow={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders only the hero when sidebar is null", () => {
    render(<TopZone hero={hero} sidebarRow={null} />);
    expect(screen.getByTestId("home-hero")).toBeTruthy();
    expect(screen.queryByTestId("sidebar-title")).toBeNull();
  });

  it("renders only the sidebar when hero is null", () => {
    // Component-level fallback: home-feed promotes sidebar to mainRows when
    // hero is absent, but TopZone itself still renders defensively if it is
    // ever passed `(null, sidebar)` directly.
    render(<TopZone hero={null} sidebarRow={sidebarRow} />);
    expect(screen.queryByTestId("home-hero")).toBeNull();
    expect(screen.getByTestId("sidebar-title")).toBeTruthy();
  });
});
