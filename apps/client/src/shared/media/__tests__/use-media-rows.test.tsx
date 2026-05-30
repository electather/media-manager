// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompactMediaItem, Page } from "@ent-mcp/shared/media";
import { mediaKeys } from "../query-keys";
import type { ClientMediaSource } from "../source";
import { mediaRowsQueryOptions, useMediaRows, useMediaRowsLazy } from "../use-media-rows";

function makeItem(id: string): CompactMediaItem {
  return { id, tmdbId: id.split(":")[1] ?? id, mediaType: "movie", title: `Title ${id}` };
}

function makeSource(
  fetchPage: ClientMediaSource<{ limit: number }>["fetchPage"],
  initialCursor?: string | null,
): ClientMediaSource<{ limit: number }> {
  return {
    sourceId: "watchlist-items",
    params: { limit: 60 },
    mode: "infinite",
    cursorOnNull: "firstPage",
    ...(initialCursor !== undefined ? { initialCursor } : {}),
    fetchPage,
  };
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading" />}>{children}</Suspense>
    </QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("mediaRowsQueryOptions", () => {
  it("keys off mediaKeys.source with the source params", () => {
    const opts = mediaRowsQueryOptions(makeSource(vi.fn()));
    expect(opts.queryKey).toEqual(mediaKeys.source("watchlist-items", { limit: 60 }));
  });

  it("threads the page cursor through getNextPageParam, ending on null", () => {
    const opts = mediaRowsQueryOptions(makeSource(vi.fn()));
    const withCursor: Page = { items: [], cursor: "c1", partial: false };
    const lastPage: Page = { items: [], cursor: null, partial: false };
    expect(opts.getNextPageParam(withCursor, [withCursor], undefined, [undefined])).toBe("c1");
    expect(opts.getNextPageParam(lastPage, [lastPage], "c1", ["c1"])).toBeUndefined();
  });

  it("flattens pages and OR-reduces partial in select", () => {
    const opts = mediaRowsQueryOptions(makeSource(vi.fn()));
    const a = makeItem("movie:1");
    const b = makeItem("movie:2");
    const projected = opts.select?.({
      pages: [
        { items: [a], cursor: "c1", partial: false },
        { items: [b], cursor: null, partial: true },
      ],
      pageParams: [undefined, "c1"],
    });
    expect(projected?.items).toEqual([a, b]);
    expect(projected?.partial).toBe(true);
  });

  it("seeds initialPageParam from the source initialCursor", () => {
    expect(mediaRowsQueryOptions(makeSource(vi.fn(), "seed-cursor")).initialPageParam).toBe(
      "seed-cursor",
    );
    expect(mediaRowsQueryOptions(makeSource(vi.fn())).initialPageParam).toBeUndefined();
  });
});

describe("useMediaRows (suspense wrapper)", () => {
  it("flattens pages, chains cursors, and OR-reduces partial across pages", async () => {
    const fetchPage = vi
      .fn<ClientMediaSource<{ limit: number }>["fetchPage"]>()
      .mockResolvedValueOnce({ items: [makeItem("movie:1")], cursor: "c1", partial: false })
      .mockResolvedValueOnce({ items: [makeItem("movie:2")], cursor: null, partial: true });
    const { result } = renderHook(() => useMediaRows(makeSource(fetchPage)), {
      wrapper: wrap(freshClient()),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.partial).toBe(false);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.partial).toBe(true);
    expect(result.current.hasNextPage).toBe(false);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: 60 }, "c1");
  });
});

describe("useMediaRowsLazy (non-suspense wrapper)", () => {
  it("starts loading then flattens the first page", async () => {
    const fetchPage = vi
      .fn<ClientMediaSource<{ limit: number }>["fetchPage"]>()
      .mockResolvedValue({ items: [makeItem("movie:1")], cursor: null, partial: false });
    const { result } = renderHook(() => useMediaRowsLazy(makeSource(fetchPage)), {
      wrapper: wrap(freshClient()),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.hasNextPage).toBe(false);
  });

  it("surfaces the error without throwing", async () => {
    const fetchPage = vi
      .fn<ClientMediaSource<{ limit: number }>["fetchPage"]>()
      .mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useMediaRowsLazy(makeSource(fetchPage)), {
      wrapper: wrap(freshClient()),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.items).toEqual([]);
  });
});
