// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: navigateMock }) };
});

const useArtworkMock = vi.hoisted(() => vi.fn(() => ({ data: undefined })));
vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: useArtworkMock,
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

const useInViewMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/hooks/use-in-view", () => ({
  useInView: useInViewMock,
}));

import { Card } from "../card";

const baseItem: CompactMediaItem = {
  id: "movie:550",
  tmdbId: "550",
  mediaType: "movie",
  title: "Fight Club",
  year: 1999,
  poster: "p.jpg",
  backdrop: "b.jpg",
};

beforeEach(() => {
  navigateMock.mockReset();
  useArtworkMock.mockReset();
  useArtworkMock.mockReturnValue({ data: undefined });
  useInViewMock.mockReset();
  useInViewMock.mockReturnValue(false);
});
afterEach(() => cleanup());

describe("Card treatment dispatch (V31)", () => {
  it("renders the default treatment when there is no progress and no episode", () => {
    render(<Card item={baseItem} rowId="trendingNow" />);
    const link = screen.getByTestId("home-card");
    expect(link.getAttribute("data-treatment")).toBe("default");
    expect(link.getAttribute("data-aspect")).toBe("poster");
  });

  it("renders the continue-watching treatment when progress is present", () => {
    const item = { ...baseItem, progress: { watched: 30, total: 60 } };
    render(<Card item={item} rowId="continueWatching" />);
    const link = screen.getByTestId("home-card");
    expect(link.getAttribute("data-treatment")).toBe("continue");
    expect(link.getAttribute("data-aspect")).toBe("backdrop");
    expect(screen.getByText(/30min left/)).toBeTruthy();
  });

  it("renders the upcoming treatment when an episode is present and there is no progress", () => {
    const item: CompactMediaItem = {
      ...baseItem,
      id: "tv:1",
      mediaType: "tv",
      episode: { season: 2, episode: 4, airsAt: Date.UTC(2026, 4, 1, 21, 0) },
    };
    render(<Card item={item} rowId="upcomingForYou" />);
    expect(screen.getByTestId("home-card").getAttribute("data-treatment")).toBe("upcoming");
  });
});

describe("Card link behaviour (V33)", () => {
  it("renders an anchor that targets the deep-link route", () => {
    render(<Card item={baseItem} rowId="trendingNow" />);
    expect(screen.getByTestId("home-card").getAttribute("href")).toBe("/media/movie:550");
  });

  it("intercepts a plain click and pushes peek with replace: false", async () => {
    const user = userEvent.setup();
    render(<Card item={baseItem} rowId="trendingNow" />);
    await user.click(screen.getByTestId("home-card"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const arg = navigateMock.mock.calls[0]![0];
    expect(arg.replace).toBe(false);
    const search = arg.search({});
    expect(search.peek).toBe("movie:550");
  });

  it("falls through to the real URL on Cmd-click", async () => {
    const user = userEvent.setup();
    render(<Card item={baseItem} rowId="trendingNow" />);
    await user.keyboard("{Meta>}");
    await user.click(screen.getByTestId("home-card"));
    await user.keyboard("{/Meta}");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("Card priority + viewport gating", () => {
  // V47: cards only fetch when an inline canonical URL is missing. The
  // priority/viewport gate then composes on top of that. Tests that probe
  // the priority/viewport behaviour must therefore start from an item
  // *without* inline poster/backdrop so the V47 gate is open.
  const itemWithoutArt: CompactMediaItem = { ...baseItem, poster: undefined, backdrop: undefined };

  function lastEnabled(): boolean | undefined {
    const calls = useArtworkMock.mock.calls;
    if (calls.length === 0) return undefined;
    const lastCall = calls[calls.length - 1] as unknown as [unknown, { enabled?: boolean }?];
    return lastCall[1]?.enabled;
  }

  it("requests artwork eagerly when priority is set, regardless of intersection", () => {
    useInViewMock.mockReturnValue(false);
    render(<Card item={itemWithoutArt} rowId="trendingNow" priority />);
    expect(lastEnabled()).toBe(true);
  });

  it("defers artwork until intersection when priority is not set", () => {
    useInViewMock.mockReturnValue(false);
    const { rerender } = render(<Card item={itemWithoutArt} rowId="trendingNow" />);
    expect(lastEnabled()).toBe(false);

    useInViewMock.mockReturnValue(true);
    rerender(<Card item={itemWithoutArt} rowId="trendingNow" />);
    expect(lastEnabled()).toBe(true);
  });

  it("attaches a ref to the rendered anchor element so the observer can watch it", () => {
    render(<Card item={baseItem} rowId="trendingNow" />);
    const link = screen.getByTestId("home-card");
    expect(link.tagName).toBe("A");
  });
});

describe("Card inline canonical URL preference (V47)", () => {
  function lastEnabled(): boolean | undefined {
    const calls = useArtworkMock.mock.calls;
    if (calls.length === 0) return undefined;
    const lastCall = calls[calls.length - 1] as unknown as [unknown, { enabled?: boolean }?];
    return lastCall[1]?.enabled;
  }

  it("renders inline poster without firing artwork.get on a poster-aspect row", () => {
    useInViewMock.mockReturnValue(true);
    render(<Card item={baseItem} rowId="trendingNow" priority />);
    expect(lastEnabled()).toBe(false);
    const img = screen.getByTestId("home-card").querySelector("img");
    expect(img?.getAttribute("src")).toBe("p.jpg");
  });

  it("renders inline backdrop without firing artwork.get on a backdrop-aspect row", () => {
    useInViewMock.mockReturnValue(true);
    const item = { ...baseItem, progress: { watched: 30, total: 60 } };
    render(<Card item={item} rowId="continueWatching" priority />);
    expect(lastEnabled()).toBe(false);
    const img = screen.getByTestId("home-card").querySelector("img");
    expect(img?.getAttribute("src")).toBe("b.jpg");
  });

  it("fires artwork.get when the relevant inline canonical URL is missing", () => {
    useInViewMock.mockReturnValue(true);
    const item: CompactMediaItem = { ...baseItem, poster: undefined };
    render(<Card item={item} rowId="trendingNow" priority />);
    expect(lastEnabled()).toBe(true);
  });
});
