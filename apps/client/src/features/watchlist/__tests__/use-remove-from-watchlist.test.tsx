// @vitest-environment happy-dom
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { useRemoveFromWatchlist } from "../hooks/use-remove-from-watchlist";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";
import { SAMPLE_WATCHLIST } from "../__fixtures__/watchlist-items.fixture";

vi.mock("@/shared/lib/watchlist/fetchers", () => ({
  fetchWatchlist: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const { removeFromWatchlist } = await import("@/shared/lib/watchlist/fetchers");
const { toast } = await import("sonner");
const removeMock = vi.mocked(removeFromWatchlist);
const toastErrorMock = vi.mocked(toast.error);

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeClient(seed: WatchlistResponse): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(watchlistKeys.list(), seed);
  return client;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRemoveFromWatchlist", () => {
  it("filters the row out optimistically", async () => {
    const client = makeClient({ items: [...SAMPLE_WATCHLIST], partial: false });
    removeMock.mockImplementation(
      () =>
        new Promise<void>(() => {
          /* never resolves */
        }),
    );
    const { result } = renderHook(() => useRemoveFromWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({ tmdbId: "11", mediaType: "movie" });
    });
    await waitFor(() => {
      const data = client.getQueryData<WatchlistResponse>(watchlistKeys.list());
      expect(data?.items.map((i) => i.tmdbId)).not.toContain("11");
    });
  });

  it("rolls back on error and surfaces a toast", async () => {
    const original: WatchlistResponse = { items: [...SAMPLE_WATCHLIST], partial: false };
    const client = makeClient(original);
    removeMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useRemoveFromWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({ tmdbId: "11", mediaType: "movie" });
    });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    const final = client.getQueryData<WatchlistResponse>(watchlistKeys.list());
    expect(final?.items.map((i) => i.tmdbId)).toContain("11");
  });
});
