import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { MoodId, WatchlistBucket, WatchlistSort } from "@ent-mcp/shared/watchlist";
import { VirtualGrid } from "@/shared/components/virtualized";
import { Button } from "@/shared/ui/button";
import { WatchlistCard } from "../../watchlist-card";
import { useAllItems } from "../../../hooks/use-all-items";

interface AllItemsProps {
  sort: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

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

  if (items.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{m.watchlist_empty()}</p>;
  }

  return (
    <>
      <VirtualGrid
        items={items}
        getKey={(it) => it.id}
        minColumnWidthPx={180}
        estimateRowHeight={() => 336}
        renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />}
      />
      {hasNextPage ? (
        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? m.watchlist_loading_more() : m.watchlist_load_more()}
          </Button>
        </div>
      ) : null}
    </>
  );
}
