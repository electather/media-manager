// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

import { SidebarItem } from "../sidebar-item";

afterEach(() => cleanup());

describe("SidebarItem", () => {
  it("renders title, episode line, and a relative date when episode is present", () => {
    const item: CompactMediaItem = {
      id: "tv:1",
      tmdbId: "1",
      mediaType: "tv",
      title: "Euphoria",
      backdrop: "b.jpg",
      episode: {
        season: 5,
        episode: 3,
        airsAt: Date.now() + 24 * 60 * 60 * 1000,
      },
    };
    render(<SidebarItem item={item} />);
    expect(screen.getByText("Euphoria")).toBeTruthy();
    expect(screen.getByText("S5 E3")).toBeTruthy();
    expect(screen.getByText(/Tomorrow|Today/)).toBeTruthy();
  });

  it("links to the deep-link route", () => {
    const item: CompactMediaItem = {
      id: "tv:42",
      tmdbId: "42",
      mediaType: "tv",
      title: "Show",
      episode: { season: 1, episode: 1, airsAt: Date.now() },
    };
    render(<SidebarItem item={item} />);
    expect(screen.getByTestId("sidebar-item").getAttribute("href")).toBe("/media/tv:42");
  });
});
