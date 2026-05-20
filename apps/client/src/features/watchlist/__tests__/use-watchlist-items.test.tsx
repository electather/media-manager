// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { useWatchlistItems } from "../hooks/use-watchlist-items";
import { WatchlistApiError } from "../lib/types";
import { SAMPLE_WATCHLIST } from "../__fixtures__/watchlist-items.fixture";

vi.mock("../lib/fetchers", () => ({
  fetchWatchlist: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

const { fetchWatchlist } = await import("../lib/fetchers");
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
  it("suspends until the fetch resolves and returns the items", async () => {
    fetchMock.mockResolvedValueOnce({ items: SAMPLE_WATCHLIST, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useWatchlistItems(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data.items).toHaveLength(SAMPLE_WATCHLIST.length);
  });

  it("propagates fetcher errors to an ErrorBoundary", async () => {
    fetchMock.mockRejectedValueOnce(new WatchlistApiError(500, { message: "kaput" }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Consumer() {
      const data = useWatchlistItems();
      return <div>{data.data.items.length}</div>;
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
