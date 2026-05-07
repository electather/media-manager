// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { useHomeFeed } from "../hooks/use-home-feed";
import { homeKeys } from "../lib/query-keys";

vi.mock("../lib/fetchers", () => ({
  fetchHomeLayout: vi.fn(),
  fetchHomeRow: vi.fn(),
  fetchHomeDetails: vi.fn(),
}));

const { fetchHomeLayout } = await import("../lib/fetchers");
const fetchHomeLayoutMock = vi.mocked(fetchHomeLayout);

const layout: HomeLayoutResponse = {
  hero: null,
  rows: [{ rowId: "trendingNow", kind: "trendingNow", titleKey: "k", initialCursor: null }],
  generatedAt: 1,
};

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Suspense fallback={null}>{children}</Suspense>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useHomeFeed", () => {
  it("returns the layout via the centralized fetcher", async () => {
    fetchHomeLayoutMock.mockResolvedValueOnce(layout);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useHomeFeed(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual(layout);
    expect(fetchHomeLayoutMock).toHaveBeenCalledTimes(1);
  });

  it("uses the homeKeys.layout() factory for the cache key", async () => {
    fetchHomeLayoutMock.mockResolvedValueOnce(layout);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useHomeFeed(), { wrapper: wrap(client) });
    await waitFor(() => expect(client.getQueryData(homeKeys.layout())).toEqual(layout));
  });
});
