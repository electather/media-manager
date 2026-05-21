// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { useWatchlistItems } from "../hooks/use-watchlist-items";
import { WatchlistApiError } from "@/shared/lib/watchlist/types";
import { SAMPLE_WATCHLIST, makeItem } from "../__fixtures__/watchlist-items.fixture";

vi.mock("@/shared/lib/watchlist/fetchers", () => ({
  fetchWatchlist: vi.fn(),
  fetchWatchlistCounts: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

const { fetchWatchlist } = await import("@/shared/lib/watchlist/fetchers");
const fetchMock = vi.mocked(fetchWatchlist);

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

describe("useWatchlistItems", () => {
  it("suspends until the first page resolves and exposes the flattened items", async () => {
    fetchMock.mockResolvedValueOnce({
      items: SAMPLE_WATCHLIST,
      cursor: null,
      partial: false,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWatchlistItems(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0));
    expect(result.current.items).toHaveLength(SAMPLE_WATCHLIST.length);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("exposes a follow-up page when the server returns a non-null cursor", async () => {
    fetchMock.mockResolvedValueOnce({
      items: [makeItem({ id: "movie:1", tmdbId: "1" })],
      cursor: "next-cursor",
      partial: false,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWatchlistItems(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.items.length).toBe(1));
    expect(result.current.hasNextPage).toBe(true);
  });

  it("threads the filter through to the fetcher and into the query key", async () => {
    fetchMock.mockResolvedValueOnce({ items: [], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWatchlistItems({ filter: "ready" }), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(result.current.items).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith({ filter: "ready" });
  });

  it("propagates fetcher errors to an ErrorBoundary", async () => {
    fetchMock.mockRejectedValueOnce(new WatchlistApiError(500, { message: "kaput" }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Consumer() {
      const data = useWatchlistItems();
      return <div>{data.items.length}</div>;
    }
    render(
      <QueryClientProvider client={client}>
        <ErrorBoundary fallback={({ error }) => <div data-testid="boundary">{error.message}</div>}>
          <Suspense fallback={<div data-testid="loading" />}>
            <Consumer />
          </Suspense>
        </ErrorBoundary>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("boundary")).toBeTruthy());
    expect(screen.getByTestId("boundary").textContent).toContain("kaput");
  });
});
