// @vitest-environment happy-dom
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import type { CompactMediaItem, Page } from "@nama/shared/media";
import { mediaKeys } from "../query-keys";
import { useIsInWatchlist, useWatchlistIdSet } from "../use-watchlist-membership";

type Pages = InfiniteData<Page, string | undefined>;

function makeItem(id: string): CompactMediaItem {
  return { id, tmdbId: id.split(":")[1] ?? id, mediaType: "movie", title: `Title ${id}` };
}

function pages(...ids: string[]): Pages {
  return {
    pages: [{ items: ids.map(makeItem), cursor: null, partial: false }],
    pageParams: [undefined],
  };
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useWatchlistIdSet (shared, #514 scope)", () => {
  it("unions ids only from watchlist-items caches, ignoring home rows under mediaKeys.root", () => {
    const client = new QueryClient();
    // A home row lives under the SAME mediaKeys.root — its items are NOT on the watchlist.
    client.setQueryData<Pages>(
      mediaKeys.source("trendingNow", { limit: 60 }),
      pages("movie:home-1", "movie:home-2"),
    );
    client.setQueryData<Pages>(
      mediaKeys.source("watchlist-items", { sort: "recent" }),
      pages("movie:wl-1"),
    );
    client.setQueryData<Pages>(
      mediaKeys.source("watchlist-items", { sort: "alpha" }),
      pages("movie:wl-2"),
    );
    const { result } = renderHook(() => useWatchlistIdSet(), { wrapper: wrap(client) });
    expect([...result.current].sort()).toEqual(["movie:wl-1", "movie:wl-2"]);
    expect(result.current.has("movie:home-1")).toBe(false);
  });

  it("also unions ids from the sibling watchlist-origin sources (mood / tonight / recently / yourWatchlist)", () => {
    const client = new QueryClient();
    // A non-watchlist home row stays excluded.
    client.setQueryData<Pages>(mediaKeys.source("trendingNow", {}), pages("movie:home-1"));
    client.setQueryData<Pages>(
      mediaKeys.source("watchlist-mood-items", { moodId: "cozy" }),
      pages("movie:mood-1"),
    );
    client.setQueryData<Pages>(mediaKeys.source("watchlist-tonight", {}), pages("movie:tonight-1"));
    client.setQueryData<Pages>(
      mediaKeys.source("watchlist-recently", { limit: 5 }),
      pages("movie:recent-1"),
    );
    client.setQueryData<Pages>(mediaKeys.source("yourWatchlist", {}), pages("movie:home-row-1"));
    const { result } = renderHook(() => useWatchlistIdSet(), { wrapper: wrap(client) });
    expect([...result.current].sort()).toEqual([
      "movie:home-row-1",
      "movie:mood-1",
      "movie:recent-1",
      "movie:tonight-1",
    ]);
    expect(result.current.has("movie:home-1")).toBe(false);
  });

  it("returns an empty set when no watchlist-items cache has loaded", () => {
    const client = new QueryClient();
    client.setQueryData<Pages>(
      mediaKeys.source("trendingNow", { limit: 60 }),
      pages("movie:home-1"),
    );
    const { result } = renderHook(() => useWatchlistIdSet(), { wrapper: wrap(client) });
    expect(result.current.size).toBe(0);
  });
});

describe("useIsInWatchlist (shared, #514 scope)", () => {
  it("is true for an item in a watchlist-items cache and false for a home-only item", () => {
    const client = new QueryClient();
    client.setQueryData<Pages>(
      mediaKeys.source("trendingNow", { limit: 60 }),
      pages("movie:home-1"),
    );
    client.setQueryData<Pages>(
      mediaKeys.source("watchlist-items", { sort: "recent" }),
      pages("movie:wl-1"),
    );
    const inWatchlist = renderHook(() => useIsInWatchlist("movie:wl-1"), { wrapper: wrap(client) });
    const homeOnly = renderHook(() => useIsInWatchlist("movie:home-1"), { wrapper: wrap(client) });
    expect(inWatchlist.result.current).toBe(true);
    expect(homeOnly.result.current).toBe(false);
  });

  it("is true for an item loaded only via a watchlist-mood-items cache (peek-modal regression)", () => {
    // Reproduces the card/peek mismatch: a mood-cluster item is saved (active DB
    // row) so its card shows the check, but the peek modal read "not on watchlist"
    // because the membership scan ignored the watchlist-mood-items source cache.
    const client = new QueryClient();
    client.setQueryData<Pages>(
      mediaKeys.source("watchlist-mood-items", { moodId: "cozy", limit: 3 }),
      pages("tv:158333"),
    );
    const { result } = renderHook(() => useIsInWatchlist("tv:158333"), { wrapper: wrap(client) });
    expect(result.current).toBe(true);
  });

  it("is true for an item in the home yourWatchlist row and false for a trending-only item", () => {
    const client = new QueryClient();
    client.setQueryData<Pages>(mediaKeys.source("yourWatchlist", {}), pages("movie:saved-1"));
    client.setQueryData<Pages>(mediaKeys.source("trendingNow", {}), pages("movie:trend-1"));
    const saved = renderHook(() => useIsInWatchlist("movie:saved-1"), { wrapper: wrap(client) });
    const trending = renderHook(() => useIsInWatchlist("movie:trend-1"), { wrapper: wrap(client) });
    expect(saved.result.current).toBe(true);
    expect(trending.result.current).toBe(false);
  });

  it("is false for an empty id", () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useIsInWatchlist(""), { wrapper: wrap(client) });
    expect(result.current).toBe(false);
  });
});
