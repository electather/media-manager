import { type CSSProperties, type ReactNode, useMemo } from "react";
import { BACKDROP_VARS, POSTER_VARS } from "@/shared/components/scroll-row";
import { PaginationSlot, usePaginationSlot } from "@/shared/components/virtualized";
import type { PaginationSlotModel } from "@/shared/components/virtualized";
import { useMediaRowsLazy } from "@/shared/media/use-media-rows";
import { useRangePrefetch } from "./use-range-prefetch";
import { homeRowSource } from "../lib/sources";
import { rowStatus } from "../lib/row-status";
import type { RowStatus } from "../lib/row-status";
import type { HomeMediaItem, RowAspect, RowData } from "../lib/types";

const ROW_STALE_MS = 5 * 60 * 1000;

export interface RowQueryResult {
  items: HomeMediaItem[];
  status: RowStatus;
  aspect: RowAspect;
  isBackdrop: boolean;
  cardVars: CSSProperties;
  error: Error | null;
  isRefetching: boolean;
  slot: PaginationSlotModel;
  /** Pass directly to `RowItemTrack.trailingSlot`; already `undefined` when idle. */
  trailingSlot: ReactNode;
  refetch: () => void;
  handleRange: (range: { startIndex: number; endIndex: number }) => void;
}

/** Collapses the infinite-query lifecycle for a home row into a single hook (#888). */
export function useRowData(row: RowData): RowQueryResult {
  const isBackdrop = row.defaultAspect === "16/9";
  const cardVars = isBackdrop ? BACKDROP_VARS : POSTER_VARS;
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
  const aspect: RowAspect = isBackdrop ? "16/9" : "2/3";
  const trailingSlot =
    slot.state === "none" ? undefined : <PaginationSlot slot={slot} variant="card" />;

  return {
    items,
    status,
    aspect,
    isBackdrop,
    cardVars,
    error,
    isRefetching,
    slot,
    trailingSlot,
    refetch,
    handleRange,
  };
}
