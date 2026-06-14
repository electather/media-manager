// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { type InfiniteData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Page } from "@nama/shared/media";
import { DEFAULT_STALE_TIME_MS } from "@/lib/query-client";
import { mediaKeys } from "@/shared/media/query-keys";
import { prefetchMediaRows, useMediaRows } from "@/shared/media/use-media-rows";
import { watchlistItemsSource } from "../lib/sources";
import { WatchlistRouteError } from "../components/watchlist-route-error";
import { makeItem } from "../__fixtures__/watchlist-items.fixture";

// Stub the shared `defineMediaSource` so the source's `fetchPage` is a spy: the
// loader prefetch hits it instead of the network, and we can assert the page it
// requested + that a warm-cache mount never re-fetches (#513).
const { fetchPageMock } = vi.hoisted(() => ({ fetchPageMock: vi.fn() }));
vi.mock("@/shared/media/source", () => ({
  defineMediaSource: (spec: Record<string, unknown>) => ({ ...spec, fetchPage: fetchPageMock }),
}));

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading" />}>{children}</Suspense>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("watchlist route loader prefetch (#513)", () => {
  it("warms the first page of a bucket source into the cache", async () => {
    const item = makeItem({ id: "movie:1", tmdbId: "1", title: "One" });
    fetchPageMock.mockResolvedValueOnce({ items: [item], cursor: "cur-1", partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const source = watchlistItemsSource({ bucket: "ready" });

    await prefetchMediaRows(client, source);

    // First page only, no cursor — mirrors the route loader.
    expect(fetchPageMock).toHaveBeenCalledTimes(1);
    expect(fetchPageMock).toHaveBeenCalledWith({ sort: "recent", bucket: "ready" }, null);
    const cached = client.getQueryData(
      mediaKeys.source("watchlist-items", { sort: "recent", bucket: "ready" }),
    ) as InfiniteData<Page> | undefined;
    expect(cached?.pages[0]?.items).toHaveLength(1);
  });

  it("renders from the warm cache on mount without re-fetching", async () => {
    const item = makeItem({ id: "movie:2", tmdbId: "2", title: "Two" });
    fetchPageMock.mockResolvedValueOnce({ items: [item], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const source = watchlistItemsSource({ bucket: "ready" });

    await prefetchMediaRows(client, source);

    // The section hooks inherit the app-wide `staleTime` default; this test's
    // QueryClient sets no default, so it pins the same production constant here.
    // The freshly-warmed cache is therefore still fresh and the suspense read
    // never refetches.
    const { result } = renderHook(
      () => useMediaRows(source, { staleTime: DEFAULT_STALE_TIME_MS }),
      {
        wrapper: wrap(client),
      },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.id).toBe("movie:2");
    expect(fetchPageMock).toHaveBeenCalledTimes(1);
  });
});

describe("WatchlistRouteError", () => {
  it("renders the watchlist fallback when a loader prefetch fails", () => {
    const client = new QueryClient();
    const reset = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <WatchlistRouteError error={new Error("prefetch boom")} reset={reset} />
      </QueryClientProvider>,
    );

    // getByText / getByRole throw if the node is absent, so a successful query
    // is the assertion (the repo's testing-library style — no jest-dom matchers).
    expect(screen.getByText("prefetch boom")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});
