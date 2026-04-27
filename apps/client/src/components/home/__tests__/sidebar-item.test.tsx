// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

const useArtworkMock = vi.hoisted(() => vi.fn(() => ({ data: undefined })));
vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: useArtworkMock,
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

import { SidebarItem } from "../sidebar-item";

afterEach(() => {
  cleanup();
  useArtworkMock.mockReset();
  useArtworkMock.mockReturnValue({ data: undefined });
});

function lastEnabled(): boolean | undefined {
  const calls = useArtworkMock.mock.calls;
  if (calls.length === 0) return undefined;
  const lastCall = calls[calls.length - 1] as unknown as [unknown, { enabled?: boolean }?];
  return lastCall[1]?.enabled;
}

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

  it("renders inline backdrop without firing artwork.get (V47)", () => {
    const item: CompactMediaItem = {
      id: "tv:7",
      tmdbId: "7",
      mediaType: "tv",
      title: "Show",
      backdrop: "b.jpg",
      episode: { season: 1, episode: 1, airsAt: Date.now() },
    };
    render(<SidebarItem item={item} />);
    expect(lastEnabled()).toBe(false);
    const img = screen.getByTestId("sidebar-item").querySelector("img");
    expect(img?.getAttribute("src")).toBe("b.jpg");
  });

  it("fires artwork.get when no inline canonical URL is present (V47)", () => {
    const item: CompactMediaItem = {
      id: "tv:8",
      tmdbId: "8",
      mediaType: "tv",
      title: "Show",
      episode: { season: 1, episode: 1, airsAt: Date.now() },
    };
    render(<SidebarItem item={item} />);
    expect(lastEnabled()).toBe(true);
  });
});
