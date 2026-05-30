// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMoods } from "../hooks/use-moods";
import { useMoodCluster } from "../hooks/use-mood-cluster";
import { watchlistKeys } from "../lib/query-keys";

// `useMoods` reads the shared aggregate fetcher; `useMoodCluster` reads through
// a `defineMediaSource` fetcher — stub both so we can assert the source params
// and query key without hitting the network.
const { fetchPageMock, fetchMoodsMock } = vi.hoisted(() => ({
  fetchPageMock: vi.fn(),
  fetchMoodsMock: vi.fn(),
}));
vi.mock("@/shared/media/source", () => ({
  defineMediaSource: (spec: Record<string, unknown>) => ({ ...spec, fetchPage: fetchPageMock }),
}));
vi.mock("@/shared/media/aggregates", () => ({
  fetchCounts: vi.fn(),
  fetchMoods: fetchMoodsMock,
}));

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

  it("useMoodCluster reads the mood source with the supplied limit", async () => {
    fetchPageMock.mockResolvedValueOnce({ items: [], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useMoodCluster("cozy", 5), { wrapper: wrap(client) });
    await waitFor(() => expect(fetchPageMock).toHaveBeenCalled());
    expect(fetchPageMock).toHaveBeenCalledWith({ moodId: "cozy", limit: 5 }, null);
  });

  it("useMoodCluster omits limit from the source params when not supplied", async () => {
    fetchPageMock.mockResolvedValueOnce({ items: [], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useMoodCluster("cozy"), { wrapper: wrap(client) });

    await waitFor(() => expect(fetchPageMock).toHaveBeenCalled());
    expect(fetchPageMock).toHaveBeenCalledWith({ moodId: "cozy" }, null);

    const query = client.getQueryCache().findAll({ queryKey: watchlistKeys.moodItems("cozy") })[0];
    expect(query).toBeDefined();
    expect(query!.queryKey).toEqual(watchlistKeys.moodItems("cozy"));
  });
});
