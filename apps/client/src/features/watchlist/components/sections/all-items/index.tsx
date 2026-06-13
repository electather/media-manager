import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { MoodId, WatchlistBucket, WatchlistSort } from "@nama/shared/watchlist";
import { VirtualGrid } from "@/shared/components/virtualized";
import { WatchlistCard } from "../../watchlist-card";
import { useAllItems } from "../../../hooks/use-all-items";
import { WatchlistEmpty } from "./empty";

interface AllItemsProps {
  sort: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

// fallow-ignore-next-line complexity
export function AllItems({ sort, bucket, mood }: AllItemsProps) {
  const args: { sort: WatchlistSort; bucket?: WatchlistBucket; mood?: MoodId } = { sort };
  if (bucket) args.bucket = bucket;
  if (mood) args.mood = mood;
  const { items, hasNextPage, isFetchingNextPage, fetchNextPage } = useAllItems(args);
  const navigate = useNavigate();
  const onPeek = useCallback(
    (id: string) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, peek: id }),
        replace: false,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
    />
  );
}
