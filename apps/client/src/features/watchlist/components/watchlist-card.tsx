import { Card } from "@/features/home/components/card";
import type { HomeMediaItem, RowKind } from "@/features/home/lib/types";
import { useToggleWatchlist } from "../hooks/use-toggle-watchlist";

interface WatchlistCardProps {
  item: HomeMediaItem;
  rowKind: RowKind;
  forceAspect?: "16/9" | "2/3";
  onPeek: (id: string) => void;
}

/**
 * Thin Card wrapper for items rendered on the watchlist page. The quick
 * action always reads as "in watchlist" (the item is on the watchlist by
 * definition) and a click removes it via the optimistic mutation.
 */
export function WatchlistCard({ item, rowKind, forceAspect, onPeek }: WatchlistCardProps) {
  const toggle = useToggleWatchlist();
  return (
    <Card
      item={item}
      rowKind={rowKind}
      forceAspect={forceAspect}
      isInWatchlist
      onWatchlistToggle={toggle}
      onClick={onPeek}
    />
  );
}
