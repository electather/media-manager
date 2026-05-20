// @vitest-environment happy-dom
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { useAddToWatchlist } from "../hooks/use-add-to-watchlist";
import { watchlistKeys } from "../lib/query-keys";
import { SAMPLE_WATCHLIST, makeItem } from "../__fixtures__/watchlist-items.fixture";

vi.mock("../lib/fetchers", () => ({
  fetchWatchlist: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const { addToWatchlist } = await import("../lib/fetchers");
const { toast } = await import("sonner");
const addMock = vi.mocked(addToWatchlist);
const toastErrorMock = vi.mocked(toast.error);

function makeClient(seed: WatchlistResponse | undefined): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) client.setQueryData(watchlistKeys.list(), seed);
  return client;
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAddToWatchlist", () => {
  it("inserts an optimistic item when a seed is provided", async () => {
    const client = makeClient({ items: [...SAMPLE_WATCHLIST], partial: false });
    addMock.mockImplementation(
      () =>
        new Promise<{ item: ReturnType<typeof makeItem>; wasActive: boolean }>(() => {
          /* never resolves; we only assert optimistic state */
        }),
    );
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "999", mediaType: "movie", source: "manual" },
        seed: { title: "New One" },
      });
    });
    await waitFor(() => {
      const data = client.getQueryData<WatchlistResponse>(watchlistKeys.list());
      expect(data?.items.map((i) => i.tmdbId)).toContain("999");
    });
  });

  it("short-circuits the optimistic insert when the row is already cached", async () => {
    const dupe = makeItem({ id: "movie:42", tmdbId: "42", title: "Existing" });
    const client = makeClient({ items: [dupe], partial: false });
    addMock.mockResolvedValueOnce({ item: dupe, wasActive: true });
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "42", mediaType: "movie", source: "manual" },
        seed: { title: "Should not duplicate" },
      });
    });
    await waitFor(() =>
      expect(client.getQueryData<WatchlistResponse>(watchlistKeys.list())?.items).toHaveLength(1),
    );
  });

  it("skips optimistic when no seed is provided and still surfaces a toast on error", async () => {
    const client = makeClient({ items: [], partial: false });
    addMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "55", mediaType: "movie", source: "manual" },
      });
    });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(client.getQueryData<WatchlistResponse>(watchlistKeys.list())?.items).toEqual([]);
  });

  it("rolls back the optimistic write on error", async () => {
    const original: WatchlistResponse = { items: [...SAMPLE_WATCHLIST], partial: false };
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
    const final = client.getQueryData<WatchlistResponse>(watchlistKeys.list());
    expect(final?.items.map((i) => i.tmdbId)).not.toContain("777");
  });
});
