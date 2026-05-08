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
});
