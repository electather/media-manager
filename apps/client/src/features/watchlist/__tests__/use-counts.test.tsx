// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCounts } from "../hooks/use-counts";

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

const { fetchCounts } = await import("@/features/watchlist/lib/fetchers");
const fetchCountsMock = vi.mocked(fetchCounts);

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

describe("useCounts", () => {
  it("suspends until the counts endpoint resolves and exposes the totals", async () => {
    fetchCountsMock.mockResolvedValueOnce({
      ready: 7,
      inProgress: 0,
      awaiting: 3,
      unavailable: 2,
      upcoming: 2,
      total: 14,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCounts(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({
      ready: 7,
      inProgress: 0,
      awaiting: 3,
      unavailable: 2,
      upcoming: 2,
      total: 14,
    });
  });
});
