import { type CSSProperties } from "react";
import { Card } from "../card/index";
import type { RowKind } from "../../lib/types";

interface RowItemProps {
  id: string;
  rowKind: RowKind;
  isInWatchlist: boolean;
  onWatchlistToggle?: (id: string) => void;
  onClick?: (id: string) => void;
  item: Parameters<typeof Card>[0]["item"];
  ref?: (el: HTMLLIElement | null) => void;
}

export function RowItem({
  id,
  rowKind,
  isInWatchlist,
  onWatchlistToggle,
  onClick,
  item,
  ref,
}: RowItemProps) {
  return (
    <li
      ref={ref}
      className="row-card shrink-0 snap-start"
      style={
        {
          width: "var(--card-w)",
          contentVisibility: "auto",
          containIntrinsicSize: "auto var(--card-w) auto var(--card-h)",
        } as CSSProperties
      }
      data-id={id}
    >
      <Card
        item={item}
        rowKind={rowKind}
        isInWatchlist={isInWatchlist}
        onWatchlistToggle={onWatchlistToggle}
        onClick={onClick}
      />
    </li>
  );
}
