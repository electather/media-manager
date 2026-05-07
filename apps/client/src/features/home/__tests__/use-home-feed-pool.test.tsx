// @vitest-environment happy-dom
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { useHomeFeedPool } from "../hooks/use-home-feed-pool";
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
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useHomeFeedPool", () => {
  it("resolves layout without suspending", async () => {
    fetchHomeLayoutMock.mockResolvedValueOnce(layout);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useHomeFeedPool(), { wrapper: wrap(client) });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(layout));
    expect(fetchHomeLayoutMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces with useHomeFeed via shared homeKeys.layout() cache slot", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData<HomeLayoutResponse>(homeKeys.layout(), layout);
    const { result } = renderHook(() => useHomeFeedPool(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.data).toEqual(layout));
    expect(fetchHomeLayoutMock).not.toHaveBeenCalled();
  });
});
