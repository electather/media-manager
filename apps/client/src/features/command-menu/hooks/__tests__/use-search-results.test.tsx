// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSearchResults } from "../use-search-results";

vi.mock("../../lib/fetchers", () => ({
  fetchSearch: vi.fn(),
}));

const { fetchSearch } = await import("../../lib/fetchers");
const fetchSearchMock = vi.mocked(fetchSearch);

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSearchResults", () => {
  it("does not fetch for queries shorter than 2 characters", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSearchResults("a", null), { wrapper: wrap(client) });
    // Allow scheduler / debounce to flush — gate is purely length-based, so the
    // mock should still be untouched after a microtask flush.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(fetchSearchMock).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(false);
  });

  it("forwards the typed query and scope to the fetcher", async () => {
    fetchSearchMock.mockResolvedValueOnce({
      results: [{ id: "tv:1", tmdbId: "1", mediaType: "tv", title: "Show" }],
      hasMore: false,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSearchResults("show", "tv"), { wrapper: wrap(client) });

    await waitFor(() => expect(fetchSearchMock).toHaveBeenCalledWith({ q: "show", kind: "tv" }));
    await waitFor(() => expect(result.current.data?.results).toHaveLength(1));
  });

  it("exposes a refetch helper when the network errors", async () => {
    fetchSearchMock.mockRejectedValueOnce(new Error("boom"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSearchResults("show", null), {
      wrapper: wrap(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(typeof result.current.refetch).toBe("function");
  });

  it("does not carry over placeholder data when scope changes", async () => {
    // A previous result for "tv" scope must not appear as placeholder when
    // the user switches to "movie" scope — cross-scope placeholders would
    // briefly label the wrong titles as results for the new scope.
    const tvItem = { id: "tv:1", tmdbId: "1", mediaType: "tv" as const, title: "Show" };
    fetchSearchMock.mockResolvedValue({ results: [tvItem], hasMore: false });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // Prime the cache with tv-scoped results.
    const { result, rerender } = renderHook(
      ({ scope }: { scope: "tv" | "movie" }) => useSearchResults("query", scope),
      { wrapper: wrap(client), initialProps: { scope: "tv" } },
    );
    await waitFor(() => expect(result.current.data?.results).toHaveLength(1));

    // Switch to movie scope — the hook must not expose the tv result as data.
    fetchSearchMock.mockResolvedValue({ results: [], hasMore: false });
    rerender({ scope: "movie" });

    // Before the new fetch resolves, data for the new scope must be undefined
    // (no cross-scope placeholder leaking).
    expect(result.current.data).toBeUndefined();
  });
});
