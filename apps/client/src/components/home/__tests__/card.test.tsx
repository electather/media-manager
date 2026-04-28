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
const useArtworkIfMissingMock = vi.hoisted(() => vi.fn(() => ({ data: undefined })));
vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: useArtworkMock,
  useArtworkIfMissing: useArtworkIfMissingMock,
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
  useArtworkIfMissingMock.mockReset();
  useArtworkIfMissingMock.mockReturnValue({ data: undefined });
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
  function lastEnabled(): boolean | undefined {
    const calls = useArtworkIfMissingMock.mock.calls;
    if (calls.length === 0) return undefined;
    const lastCall = calls[calls.length - 1] as unknown as [
      unknown,
      unknown,
      { enabled?: boolean }?,
    ];
    return lastCall[2]?.enabled;
  }

  it("requests artwork eagerly when priority is set, regardless of intersection", () => {
    useInViewMock.mockReturnValue(false);
    render(<Card item={baseItem} rowId="trendingNow" priority />);
    expect(lastEnabled()).toBe(true);
  });

  it("defers artwork until intersection when priority is not set", () => {
    useInViewMock.mockReturnValue(false);
    const { rerender } = render(<Card item={baseItem} rowId="trendingNow" />);
    expect(lastEnabled()).toBe(false);

    useInViewMock.mockReturnValue(true);
    rerender(<Card item={baseItem} rowId="trendingNow" />);
    expect(lastEnabled()).toBe(true);
  });

  it("attaches a ref to the rendered anchor element so the observer can watch it", () => {
    render(<Card item={baseItem} rowId="trendingNow" />);
    const link = screen.getByTestId("home-card");
    expect(link.tagName).toBe("A");
  });

  it("declares poster as the required slot when calling useArtworkIfMissing", () => {
    useInViewMock.mockReturnValue(true);
    render(<Card item={baseItem} rowId="trendingNow" />);
    const lastCall = useArtworkIfMissingMock.mock.calls.at(-1) as
      | [unknown, string[], unknown?]
      | undefined;
    expect(lastCall?.[1]).toEqual(["poster"]);
  });
});
