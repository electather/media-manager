import { useMemo } from "react";
import { Row } from "@/features/home/components/row";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { buildRelatedRow } from "../lib/related-items";

type Props = {
  item: HomeMediaItem;
  watchlist: ReadonlySet<string>;
  onWatchlistToggle: (id: string) => void;
  onCardClick: (id: string) => void;
};

export function DetailRelatedRow({ item, watchlist, onWatchlistToggle, onCardClick }: Props) {
  const row = useMemo(() => buildRelatedRow(item), [item]);
  if (row.items.length === 0) return null;
  return (
    <Row
      row={row}
      watchlist={watchlist}
      onWatchlistToggle={onWatchlistToggle}
      onCardClick={onCardClick}
    />
  );
}
