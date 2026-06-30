import { useCallback } from "react";

/** Trigger the next page once the visible range gets this close to the tail. */
const PREFETCH_OFFSET = 4;

interface RangePrefetchArgs {
  itemCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

/**
 * Returns a `ScrollRowTrack.onRangeChange` handler that pages ahead when the
 * viewport nears the end of the loaded items. Bails on an empty set, when there
 * is no next page, or while a fetch is already in flight.
 */
export function useRangePrefetch({
  itemCount,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: RangePrefetchArgs) {
  return useCallback(
    ({ endIndex }: { startIndex: number; endIndex: number }) => {
      if (itemCount === 0) return;
      if (!hasNextPage || isFetchingNextPage) return;
      if (endIndex >= itemCount - PREFETCH_OFFSET) fetchNextPage();
    },
    [itemCount, hasNextPage, isFetchingNextPage, fetchNextPage],
  );
}
