import { useMemo } from "react";
import { usePaginationSlot } from "@/shared/components/virtualized";
import type { PaginationSlotModel } from "@/shared/components/virtualized";
import { useMediaRowsLazy } from "@/shared/media/use-media-rows";
import { useRangePrefetch } from "./use-range-prefetch";
import { homeRowSource } from "../lib/sources";
import { rowStatus } from "../lib/row-status";
import type { RowStatus } from "../lib/row-status";
import type { HomeMediaItem, RowData } from "../lib/types";

const ROW_STALE_MS = 5 * 60 * 1000;

export interface RowQueryResult {
  items: HomeMediaItem[];
  status: RowStatus;
  error: Error | null;
  isRefetching: boolean;
  slot: PaginationSlotModel;
  refetch: () => void;
  handleRange: (range: { startIndex: number; endIndex: number }) => void;
}

/** Collapses the infinite-query lifecycle for a home row into a single hook. */
export function useRowData(row: RowData): RowQueryResult {
  const source = useMemo(
    () => homeRowSource(row.id, row.initialCursor),
    [row.id, row.initialCursor],
  );
  const {
    items,
    fetchNextPage,
    hasNextPage,
    isLoading,
    isFetchingNextPage,
    error,
    refetch,
    isRefetching,
  } = useMediaRowsLazy(source, { staleTime: ROW_STALE_MS });

  const slot = usePaginationSlot({
    itemCount: items.length,
    hasNextPage,
    isFetchingNextPage,
    error,
    fetchNextPage,
  });

  const handleRange = useRangePrefetch({
    itemCount: items.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

  const status = rowStatus({ error, isLoading, itemCount: items.length });

  return { items, status, error, isRefetching, slot, refetch, handleRange };
}
