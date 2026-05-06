// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { MediaDetailsResponse } from "@ent-mcp/shared/home";
import { useMediaItem } from "../lib/find-item";

afterEach(() => vi.restoreAllMocks());

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const payload: MediaDetailsResponse = {
  summary: {
    id: "movie:550",
    tmdbId: "550",
    mediaType: "movie",
    title: "Fight Club",
    status: "available",
  },
  details: { cast: ["Edward"], director: "Fincher" },
};

describe("useMediaItem", () => {
  it("resolves a composite id via /api/home/details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMediaItem("movie:550"), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.item?.title).toBe("Fight Club"));
    expect(result.current.item?.cast).toEqual(["Edward"]);
    expect(result.current.item?.director).toBe("Fincher");
  });

  it("returns null while the query is pending", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMediaItem("movie:550"), { wrapper: wrap(client) });
    expect(result.current.item).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it("returns null for malformed composite ids", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMediaItem("not-a-composite"), { wrapper: wrap(client) });
    expect(result.current.item).toBeNull();
  });
});
