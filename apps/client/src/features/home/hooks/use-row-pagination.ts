import { useInfiniteQuery } from "@tanstack/react-query";
import type { CompactMediaItem, RowContentResponse, RowKind } from "@ent-mcp/shared/home";

import { api } from "@/shared/lib/api";

import { homeKeys } from "../lib/keys";

interface UseRowPaginationOptions {
  rowId: RowKind;
  initialCursor: string | null;
  onUnavailable?: () => void;
}

interface UseRowPaginationResult {
  items: CompactMediaItem[];
  partial: boolean;
  hasMore: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  fetchNext: () => void;
  error: Error | null;
}

export function useRowPagination(options: UseRowPaginationOptions): UseRowPaginationResult {
  const { rowId, initialCursor, onUnavailable } = options;

  const query = useInfiniteQuery<RowContentResponse, Error>({
    queryKey: homeKeys.row(rowId, initialCursor),
    queryFn: async ({ pageParam }): Promise<RowContentResponse> => {
      const cursor = (pageParam as string | null) ?? null;
      const res = await api.home.getRowContent.$post({ json: { rowId, cursor } });
      if (!res.ok) {
        const body = await res.text();
        if (body.includes("home.row_unavailable")) {
          onUnavailable?.();
          throw new Error("home.row_unavailable");
        }
        throw new Error(body || "home.internal");
      }
      return (await res.json()) as RowContentResponse;
    },
    initialPageParam: initialCursor as unknown,
    getNextPageParam: (last) => last.cursor ?? undefined,
  });

  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const partial = pages.some((p) => p.partial === true);
  const lastCursor = pages.length > 0 ? pages[pages.length - 1]!.cursor : initialCursor;
  const hasMore = lastCursor !== null;

  return {
    items,
    partial,
    hasMore,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNext: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    error: query.error ?? null,
  };
}
