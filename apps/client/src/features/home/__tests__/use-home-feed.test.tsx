// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";
import { useHomeFeed } from "../hooks/use-home-feed";

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
  vi.restoreAllMocks();
});

describe("useHomeFeed", () => {
  it("fetches /api/home/layout and surfaces the parsed response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(layout), { status: 200 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useHomeFeed(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(layout);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/home/layout",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("surfaces errors when the endpoint returns non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("bad", { status: 500 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useHomeFeed(), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("500");
  });
});
