import { ROW_ASPECT } from "../../lib/home-feed-config";
import type { HomeMediaItem, RowKind } from "../../lib/types";
import { CardActions } from "./card-actions";
import { CardBadges } from "./card-badges";
import { CardImage } from "./card-image";
import { CardMatchReason } from "./card-match-reason";
import { CardProgress } from "./card-progress";

interface CardProps {
  item: HomeMediaItem;
  rowKind: RowKind;
  onWatchlistToggle?: () => void;
  onRequest?: () => void;
}

/** Orchestrates all card sub-components into a single media card for a row. */
export function Card({ item, rowKind, onWatchlistToggle, onRequest }: CardProps) {
  const aspect = ROW_ASPECT[rowKind];

  return (
    <article className="flex w-full flex-col">
      <div className="relative">
        <CardImage item={item} aspect={aspect} />
        <div className="absolute start-2 top-2">
          <CardBadges status={item.availability} />
        </div>
      </div>
      <div className="mt-2 flex flex-col gap-1 px-0.5">
        <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
        {item.year && <p className="text-xs text-muted-foreground">{item.year}</p>}
        <CardMatchReason item={item} />
        <CardProgress item={item} />
        <CardActions item={item} onWatchlistToggle={onWatchlistToggle} onRequest={onRequest} />
      </div>
    </article>
  );
}
