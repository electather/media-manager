// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAllItems } from "../hooks/use-all-items";
import { makeItem } from "../__fixtures__/watchlist-items.fixture";

// Stub the shared `defineMediaSource` so the source's `fetchPage` is a spy we
// can assert against — this pins what params `useAllItems` builds and that the
// shared infinite hook threads the cursor, without hitting the network.
const { fetchPageMock } = vi.hoisted(() => ({ fetchPageMock: vi.fn() }));
vi.mock("@/shared/media/source", () => ({
  defineMediaSource: (spec: Record<string, unknown>) => ({ ...spec, fetchPage: fetchPageMock }),
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

describe("useAllItems", () => {
  it("builds the watchlist-items source params from sort, bucket, and mood", async () => {
    fetchPageMock.mockResolvedValueOnce({ items: [], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useAllItems({ sort: "alpha", bucket: "ready", mood: "cozy" }), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(fetchPageMock).toHaveBeenCalled());
    expect(fetchPageMock).toHaveBeenCalledWith(
      { sort: "alpha", bucket: "ready", mood: "cozy" },
      null,
    );
  });

  it("flattens pages and chains cursors through fetchNextPage", async () => {
    const page1 = makeItem({ id: "movie:1", tmdbId: "1", title: "One" });
    const page2 = makeItem({ id: "movie:2", tmdbId: "2", title: "Two" });
    fetchPageMock.mockResolvedValueOnce({ items: [page1], cursor: "cur-1", partial: false });
    fetchPageMock.mockResolvedValueOnce({ items: [page2], cursor: null, partial: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAllItems({ sort: "recent" }), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(fetchPageMock).toHaveBeenNthCalledWith(1, { sort: "recent" }, null);
    expect(fetchPageMock).toHaveBeenNthCalledWith(2, { sort: "recent" }, "cur-1");
    expect(result.current.hasNextPage).toBe(false);
  });
});
