// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWatchlistCounts } from "../hooks/use-watchlist-counts";

vi.mock("@/shared/lib/watchlist/fetchers", () => ({
  fetchWatchlist: vi.fn(),
  fetchWatchlistCounts: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

const { fetchWatchlistCounts } = await import("@/shared/lib/watchlist/fetchers");
const fetchCountsMock = vi.mocked(fetchWatchlistCounts);

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

describe("useWatchlistCounts", () => {
  it("suspends until the counts endpoint resolves and exposes the totals", async () => {
    fetchCountsMock.mockResolvedValueOnce({
      ready: 7,
      inProgress: 0,
      awaiting: 3,
      upcoming: 2,
      total: 14,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWatchlistCounts(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      ready: 7,
      inProgress: 0,
      awaiting: 3,
      upcoming: 2,
      total: 14,
    });
  });
});
