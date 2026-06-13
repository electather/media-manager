// @vitest-environment happy-dom
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { isEqual } from "es-toolkit";
import type { CompactMediaItem, Page } from "@nama/shared/media";
import { mediaKeys } from "../query-keys";
import { useAddToWatchlist, useRemoveFromWatchlist } from "../use-watchlist-mutations";

vi.mock("../media-writes", () => ({
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { addToWatchlist, removeFromWatchlist } = await import("../media-writes");
const { toast } = await import("sonner");
const addMock = vi.mocked(addToWatchlist);
const removeMock = vi.mocked(removeFromWatchlist);
const toastErrorMock = vi.mocked(toast.error);

type Pages = InfiniteData<Page, string | undefined>;

const DEFAULT_KEY = mediaKeys.source("watchlist-items", { sort: "recent" });

function makeItem(id: string, tmdbId: string): CompactMediaItem {
  return { id, tmdbId, mediaType: "movie", title: `Title ${id}` };
}

function makeClient(seed?: Page): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed) {
    const pages: Pages = { pages: [seed], pageParams: [undefined] };
    client.setQueryData<Pages>(DEFAULT_KEY, pages);
  }
  return client;
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function flattenIds(client: QueryClient): string[] {
  const data = client.getQueryData<Pages>(DEFAULT_KEY);
  return data?.pages.flatMap((p) => p.items.map((i) => i.id)) ?? [];
}

function rootInvalidations(spy: ReturnType<typeof vi.spyOn>): unknown[] {
  const calls = spy.mock.calls as unknown[][];
  return calls.filter((call) => {
    const arg = call[0] as { queryKey?: readonly unknown[] } | undefined;
    return isEqual(arg?.queryKey, mediaKeys.root);
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAddToWatchlist (shared)", () => {
  it("inserts an optimistic row into the default all-items cache when seeded", async () => {
    const client = makeClient({ items: [makeItem("movie:1", "1")], cursor: null, partial: false });
    addMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "999", mediaType: "movie", source: "manual" },
        seed: { title: "New One" },
      });
    });
    await waitFor(() => expect(flattenIds(client)).toContain("movie:999"));
  });

  it("seeds an empty cache so cross-feature membership flips before first visit", async () => {
    const client = makeClient();
    addMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "55", mediaType: "movie", source: "manual" },
        seed: { title: "Seeded" },
      });
    });
    await waitFor(() => expect(flattenIds(client)).toContain("movie:55"));
  });

  it("invalidates mediaKeys.root exactly once on settle (#505)", async () => {
    const client = makeClient({ items: [], cursor: null, partial: false });
    addMock.mockResolvedValueOnce({
      item: makeItem("movie:200", "200"),
      wasActive: false,
    } as never);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "200", mediaType: "movie", source: "manual" },
        seed: { title: "Settled" },
      });
    });
    await waitFor(() => expect(addMock).toHaveBeenCalled());
    await waitFor(() => expect(rootInvalidations(invalidateSpy)).toHaveLength(1));
  });

  it("rolls back the optimistic write and toasts on error", async () => {
    const client = makeClient({ items: [makeItem("movie:1", "1")], cursor: null, partial: false });
    addMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useAddToWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({
        request: { tmdbId: "777", mediaType: "movie", source: "manual" },
        seed: { title: "Will roll back" },
      });
    });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(flattenIds(client)).not.toContain("movie:777");
  });
});

describe("useRemoveFromWatchlist (shared)", () => {
  it("filters the row out optimistically across loaded pages", async () => {
    const client = makeClient({
      items: [makeItem("movie:11", "11"), makeItem("movie:12", "12")],
      cursor: null,
      partial: false,
    });
    removeMock.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useRemoveFromWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({ tmdbId: "11", mediaType: "movie" });
    });
    await waitFor(() => expect(flattenIds(client)).not.toContain("movie:11"));
    expect(flattenIds(client)).toContain("movie:12");
  });

  it("invalidates mediaKeys.root exactly once on settle (#505)", async () => {
    const client = makeClient({
      items: [makeItem("movie:11", "11")],
      cursor: null,
      partial: false,
    });
    removeMock.mockResolvedValueOnce(undefined);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRemoveFromWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({ tmdbId: "11", mediaType: "movie" });
    });
    await waitFor(() => expect(removeMock).toHaveBeenCalled());
    await waitFor(() => expect(rootInvalidations(invalidateSpy)).toHaveLength(1));
  });

  it("rolls back and toasts on error", async () => {
    const client = makeClient({
      items: [makeItem("movie:11", "11")],
      cursor: null,
      partial: false,
    });
    removeMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useRemoveFromWatchlist(), { wrapper: wrap(client) });
    act(() => {
      result.current.mutate({ tmdbId: "11", mediaType: "movie" });
    });
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(flattenIds(client)).toContain("movie:11");
  });
});
