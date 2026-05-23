// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAllItems } from "../hooks/use-all-items";
import { makeItem } from "../__fixtures__/watchlist-items.fixture";

vi.mock("@/features/watchlist/lib/fetchers", () => ({
  fetchItems: vi.fn(),
  fetchCounts: vi.fn(),
  fetchTonight: vi.fn(),
  fetchRecently: vi.fn(),
  fetchMoods: vi.fn(),
  fetchMoodItems: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

const { fetchItems } = await import("@/features/watchlist/lib/fetchers");
const fetchItemsMock = vi.mocked(fetchItems);

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading" />}>{children}</Suspense>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAllItems", () => {
  it("forwards sort, bucket, and mood to fetchItems on the first page", async () => {
    fetchItemsMock.mockResolvedValueOnce({ items: [], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useAllItems({ sort: "alpha", bucket: "ready", mood: "cozy" }), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(fetchItemsMock).toHaveBeenCalled());
    expect(fetchItemsMock).toHaveBeenCalledWith({
      sort: "alpha",
      bucket: "ready",
      mood: "cozy",
    });
  });

  it("flattens pages and chains cursors through fetchNextPage", async () => {
    const page1 = makeItem({ id: "movie:1", tmdbId: "1", title: "One" });
    const page2 = makeItem({ id: "movie:2", tmdbId: "2", title: "Two" });
    fetchItemsMock.mockResolvedValueOnce({ items: [page1], cursor: "cur-1", partial: false });
    fetchItemsMock.mockResolvedValueOnce({ items: [page2], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAllItems({ sort: "recent" }), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(fetchItemsMock).toHaveBeenNthCalledWith(2, { sort: "recent", cursor: "cur-1" });
    expect(result.current.hasNextPage).toBe(false);
  });
});
