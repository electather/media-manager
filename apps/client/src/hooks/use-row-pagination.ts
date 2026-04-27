import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { CompactMediaItem, RowContentResponse, RowKind } from "@ent-mcp/shared/home";
import { api } from "@/lib/api";

export interface UseRowPaginationArgs {
  rowId: RowKind;
  /** Cursor to use for the first `getRowContent` call. Null means first page. */
  initialCursor: string | null;
  onUnavailable?: () => void;
}

/**
 * Cache key includes `initialCursor` so a layout refetch that returns a new
 * seed-pinned cursor (currently only `becauseYouWatched` after the seed item
 * changes) invalidates the row's stored pageParams. Without this the row
 * would refetch using the stale initial pageParam and render content from a
 * different seed than the stub subtitle describes.
 */
export const homeRowQueryKey = (rowId: RowKind, initialCursor: string | null) =>
  ["home", "row", rowId, initialCursor] as const;

interface RowPage {
  items: CompactMediaItem[];
  cursor: string | null;
  partial?: true;
}

async function fetchRowPage(rowId: RowKind, cursor: string | null): Promise<RowPage> {
  const res = await api.home.getRowContent.$post({ json: { rowId, cursor } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    const err = new Error(`home.getRowContent failed: ${res.status}`);
    (err as { code?: string }).code = body?.code;
    throw err;
  }
  return (await res.json()) as RowContentResponse;
}

export function useRowPagination({ rowId, initialCursor, onUnavailable }: UseRowPaginationArgs) {
  const query = useInfiniteQuery<
    RowPage,
    Error & { code?: string },
    { pages: RowPage[]; pageParams: (string | null)[] },
    ReturnType<typeof homeRowQueryKey>,
    string | null
  >({
    queryKey: homeRowQueryKey(rowId, initialCursor),
    initialPageParam: initialCursor,
    queryFn: ({ pageParam }) => fetchRowPage(rowId, pageParam),
    getNextPageParam: (last) => last.cursor ?? undefined,
    staleTime: 60_000,
  });

  const errorCode = query.error?.code;
  useEffect(() => {
    if (errorCode === "home.row_unavailable") onUnavailable?.();
  }, [errorCode, onUnavailable]);

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const lastPage = query.data?.pages.at(-1);
  const cursor = lastPage?.cursor ?? null;
  const isPartial = query.data?.pages.some((p) => p.partial) ?? false;

  return {
    items,
    cursor,
    hasMore: cursor !== null,
    isFetching: query.isFetching,
    isPending: query.isPending,
    isPartial,
    fetchNext: query.fetchNextPage,
  } as const;
}
