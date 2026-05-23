// @vitest-environment happy-dom
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { useAddToWatchlist } from "../hooks/use-add-to-watchlist";
import { watchlistKeys } from "@/features/watchlist/lib/query-keys";
import { SAMPLE_WATCHLIST, makeItem } from "../__fixtures__/watchlist-items.fixture";

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

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const { addToWatchlist } = await import("@/features/watchlist/lib/fetchers");
const { toast } = await import("sonner");
const addMock = vi.mocked(addToWatchlist);
const toastErrorMock = vi.mocked(toast.error);

type Pages = InfiniteData<WatchlistResponse, string | undefined>;

function makeClient(seed: WatchlistResponse | undefined): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) {
    const pages: Pages = { pages: [seed], pageParams: [undefined] };
    client.setQueryData<Pages>(watchlistKeys.items(), pages);
  }
  return client;
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function flattenIds(client: QueryClient): string[] {
  const data = client.getQueryData<Pages>(watchlistKeys.items());
  return data?.pages.flatMap((p) => p.items.map((i) => i.tmdbId)) ?? [];
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAddToWatchlist", () => {
  it("inserts an optimistic item into the first loaded page when a seed is provided", async () => {
    const client = makeClient({ items: [...SAMPLE_WATCHLIST], cursor: null, partial: false });
    addMock.mockImplementation(
      () =>
        new Promise<{ item: ReturnType<typeof makeItem>; wasActive: boolean }>(() => {
          /* never resolves */
        }),
    );
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "999", mediaType: "movie", source: "manual" },
        seed: { title: "New One" },
      });
    });
    await waitFor(() => expect(flattenIds(client)).toContain("999"));
  });

  it("short-circuits the optimistic insert when the row is already cached", async () => {
    const dupe = makeItem({ id: "movie:42", tmdbId: "42", title: "Existing" });
    const client = makeClient({ items: [dupe], cursor: null, partial: false });
    addMock.mockResolvedValueOnce({ item: dupe, wasActive: true });
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "42", mediaType: "movie", source: "manual" },
        seed: { title: "Should not duplicate" },
      });
    });
    await waitFor(() => expect(flattenIds(client).filter((id) => id === "42")).toHaveLength(1));
  });

  it("skips optimistic when no seed is provided and still surfaces a toast on error", async () => {
    const client = makeClient({ items: [], cursor: null, partial: false });
    addMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "55", mediaType: "movie", source: "manual" },
      });
    });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(flattenIds(client)).toEqual([]);
  });

  it("invalidates the entire watchlist key tree once on settle (V.WL5)", async () => {
    const client = makeClient({ items: [], cursor: null, partial: false });
    addMock.mockResolvedValueOnce({
      item: makeItem({ id: "movie:200", tmdbId: "200", title: "Settled" }),
      wasActive: false,
    });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "200", mediaType: "movie", source: "manual" },
        seed: { title: "Settled" },
      });
    });
    await waitFor(() => expect(addMock).toHaveBeenCalled());
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
    const rootCalls = invalidateSpy.mock.calls.filter(
      ([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey) === '["watchlist"]',
    );
    expect(rootCalls).toHaveLength(1);
  });

  it("rolls back the optimistic write on error", async () => {
    const original: WatchlistResponse = {
      items: [...SAMPLE_WATCHLIST],
      cursor: null,
      partial: false,
    };
    const client = makeClient(original);
    addMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "777", mediaType: "movie", source: "manual" },
        seed: { title: "Will roll back" },
      });
    });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(flattenIds(client)).not.toContain("777");
  });
});
