// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMoods } from "../hooks/use-moods";
import { useMoodCluster } from "../hooks/use-mood-cluster";
import { watchlistKeys } from "../lib/query-keys";

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

const { fetchMoods, fetchMoodItems } = await import("@/features/watchlist/lib/fetchers");
const fetchMoodsMock = vi.mocked(fetchMoods);
const fetchMoodItemsMock = vi.mocked(fetchMoodItems);

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

describe("useMoods + useMoodCluster", () => {
  it("useMoods exposes the cluster summary", async () => {
    fetchMoodsMock.mockResolvedValueOnce({ clusters: [{ moodId: "cozy", count: 4 }] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMoods(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data.clusters[0]).toEqual({ moodId: "cozy", count: 4 });
  });

  it("useMoodCluster paginates against fetchMoodItems with the supplied limit", async () => {
    fetchMoodItemsMock.mockResolvedValueOnce({ items: [], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useMoodCluster("cozy", 5), { wrapper: wrap(client) });
    await waitFor(() => expect(fetchMoodItemsMock).toHaveBeenCalled());
    expect(fetchMoodItemsMock).toHaveBeenCalledWith("cozy", { limit: 5 });
  });

  it("useMoodCluster does not leak null into the query key when limit is omitted", async () => {
    fetchMoodItemsMock.mockResolvedValueOnce({ items: [], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useMoodCluster("cozy"), { wrapper: wrap(client) });

    await waitFor(() => expect(fetchMoodItemsMock).toHaveBeenCalled());

    const query = client.getQueryCache().findAll({ queryKey: watchlistKeys.moodItems("cozy") })[0];
    expect(query).toBeDefined();
    expect(query!.queryKey).toEqual([...watchlistKeys.moodItems("cozy"), undefined]);
  });
});
