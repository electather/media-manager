// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  useMediaRowsInfinite,
  useMediaRowsInfiniteSuspense,
  type MediaRowsPage,
} from "../use-media-rows-infinite";

interface Row {
  id: string;
}

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading" />}>{children}</Suspense>
    </QueryClientProvider>
  );
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("useMediaRowsInfinite (non-suspense)", () => {
  it("flattens items across pages and exposes hasNextPage from the cursor tail", async () => {
    const fetchPage = vi.fn(async (cursor: string | null): Promise<MediaRowsPage<Row>> => {
      if (cursor == null) return { items: [{ id: "a" }, { id: "b" }], cursor: "p2" };
      return { items: [{ id: "c" }], cursor: null };
    });
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMediaRowsInfinite<Row, string | null>({
          queryKey: ["test", "row", "trending"],
          initialPageParam: null,
          fetchPage,
          getNextPageParam: (last) => last.cursor ?? undefined,
        }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.current.hasNextPage).toBe(true);
    act(() => {
      result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it("propagates `partial` from any page once it lands and stays true", async () => {
    const fetchPage = vi.fn(async (cursor: string | null): Promise<MediaRowsPage<Row>> => {
      if (cursor == null) return { items: [{ id: "x" }], cursor: "p2", partial: true };
      return { items: [{ id: "y" }], cursor: null, partial: false };
    });
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMediaRowsInfinite<Row, string | null>({
          queryKey: ["test", "row", "partial"],
          initialPageParam: null,
          fetchPage,
          getNextPageParam: (last) => last.cursor ?? undefined,
        }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => expect(result.current.partial).toBe(true));
    act(() => {
      result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.partial).toBe(true);
  });
});

describe("useMediaRowsInfinite (offset pagination)", () => {
  it("threads numeric offset page params through fetchPage", async () => {
    const fetchPage = vi.fn(async (offset: number): Promise<MediaRowsPage<Row>> => {
      if (offset === 0) return { items: [{ id: "0" }, { id: "1" }], nextOffset: 2 };
      return { items: [{ id: "2" }], nextOffset: null };
    });
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMediaRowsInfinite<Row, number>({
          queryKey: ["test", "list", "offset"],
          initialPageParam: 0,
          fetchPage,
          getNextPageParam: (last) => last.nextOffset ?? undefined,
        }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(fetchPage).toHaveBeenLastCalledWith(0);
    act(() => {
      result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useMediaRowsInfiniteSuspense", () => {
  it("suspends until the first page resolves and exposes the flattened items", async () => {
    const fetchPage = vi.fn(
      async (): Promise<MediaRowsPage<Row>> => ({
        items: [{ id: "a" }, { id: "b" }],
        cursor: null,
      }),
    );
    const client = makeClient();
    const { result } = renderHook(
      () =>
        useMediaRowsInfiniteSuspense<Row, string | undefined>({
          queryKey: ["test", "suspense", "list"],
          initialPageParam: undefined,
          fetchPage,
          getNextPageParam: (last) => last.cursor ?? undefined,
        }),
      { wrapper: wrap(client) },
    );
    await waitFor(() => expect(result.current.items).toBeDefined());
    expect(result.current.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result.current.hasNextPage).toBe(false);
  });
});
