import { useCallback } from "react";
import type { MoodId, WatchlistBucket, WatchlistSort } from "@nama/shared/watchlist";
import { PaginationSlot, usePaginationSlot, VirtualGrid } from "@/shared/components/virtualized";
import { WatchlistCard } from "../../watchlist-card";
import { useAllItems } from "../../../hooks/use-all-items";
import { useWatchlistPeek } from "../../../hooks/use-watchlist-peek";
import { WatchlistEmpty } from "./empty";

interface AllItemsProps {
  sort: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

export function AllItems({ sort, bucket, mood }: AllItemsProps) {
  const { items, hasNextPage, isFetchingNextPage, fetchNextPage, error } = useAllItems({
    sort,
    bucket,
    mood,
  });
  const onPeek = useWatchlistPeek();
  // `error == null` stops the auto-load re-firing after an append failure,
  // which would clobber the retry slot with a fresh fetch every render (#888).
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && error == null) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, error, fetchNextPage]);
  const slot = usePaginationSlot({
    itemCount: items.length,
    hasNextPage,
    isFetchingNextPage,
    error,
    fetchNextPage,
  });

  if (items.length === 0) {
    return <WatchlistEmpty bucket={bucket} mood={mood} />;
  }

  return (
    <VirtualGrid
      items={items}
      getKey={(it) => it.id}
      minColumnWidthPx={180}
      estimateRowHeight={() => 336}
      renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />}
      onEndReached={onEndReached}
      trailingSlot={<PaginationSlot slot={slot} variant="row" />}
    />
  );
}
