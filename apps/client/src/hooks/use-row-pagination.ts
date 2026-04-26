import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { CompactMediaItem, RowContentResponse, RowKind } from "@ent-mcp/shared/home";
import { api } from "@/lib/api";

export interface UseRowPaginationArgs {
  rowId: RowKind;
  initialItems: CompactMediaItem[];
  initialCursor: string | null;
  onUnavailable?: () => void;
}

export const homeRowQueryKey = (rowId: RowKind) => ["home", "row", rowId] as const;

const INITIAL_PAGE_SENTINEL = Symbol("initial-page");
type PageParam = string | null | typeof INITIAL_PAGE_SENTINEL;

interface RowPage {
  items: CompactMediaItem[];
  cursor: string | null;
  partial?: true;
}

async function fetchRowPage(rowId: RowKind, cursor: string): Promise<RowPage> {
  const res = await api.home.getRowContent.$post({ json: { rowId, cursor } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    const err = new Error(`home.getRowContent failed: ${res.status}`);
    (err as { code?: string }).code = body?.code;
    throw err;
  }
  return (await res.json()) as RowContentResponse;
}

export function useRowPagination({
  rowId,
  initialItems,
  initialCursor,
  onUnavailable,
}: UseRowPaginationArgs) {
  const query = useInfiniteQuery<
    RowPage,
    Error & { code?: string },
    { pages: RowPage[]; pageParams: PageParam[] },
    ReturnType<typeof homeRowQueryKey>,
    PageParam
  >({
    queryKey: homeRowQueryKey(rowId),
    initialPageParam: INITIAL_PAGE_SENTINEL,
    queryFn: async ({ pageParam }) => {
      if (pageParam === INITIAL_PAGE_SENTINEL || pageParam === null) {
        return { items: initialItems, cursor: initialCursor };
      }
      return fetchRowPage(rowId, pageParam);
    },
    getNextPageParam: (last) => last.cursor,
    initialData: {
      pages: [{ items: initialItems, cursor: initialCursor }],
      pageParams: [INITIAL_PAGE_SENTINEL],
    },
    staleTime: 60_000,
  });

  const errorCode = query.error?.code;
  useEffect(() => {
    if (errorCode === "home.row_unavailable") onUnavailable?.();
  }, [errorCode, onUnavailable]);

  const items = query.data?.pages.flatMap((p) => p.items) ?? initialItems;
  const lastPage = query.data?.pages.at(-1);
  const cursor = lastPage ? lastPage.cursor : initialCursor;

  return {
    items,
    cursor,
    hasMore: cursor !== null,
    isFetching: query.isFetchingNextPage,
    fetchNext: query.fetchNextPage,
  } as const;
}
