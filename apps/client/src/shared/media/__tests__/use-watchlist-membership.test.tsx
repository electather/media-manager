// @vitest-environment happy-dom
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import type { CompactMediaItem, Page } from "@ent-mcp/shared/media";
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

  it("is false for an empty id", () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useIsInWatchlist(""), { wrapper: wrap(client) });
    expect(result.current).toBe(false);
  });
});
