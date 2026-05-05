import * as m from "@/paraglide/messages";
import { Skeleton } from "@/shared/ui/skeleton";
import { ROW_COPY } from "../../lib/home-feed-config";
import type { RowData } from "../../lib/types";
import { Card } from "../card/index";

/** Number of skeleton placeholder cards to show while content loads. */
const SKELETON_COUNT = 5;

interface RowScrollerProps {
  row: RowData;
  watchlist?: ReadonlySet<string>;
  onWatchlistToggle?: (id: string) => void;
  onRequest?: (id: string) => void;
}

/** Renders a horizontally scrollable list of cards, or skeleton placeholders when empty. */
export function RowScroller({ row, watchlist, onWatchlistToggle, onRequest }: RowScrollerProps) {
  const isBackdrop = row.defaultAspect === "16/9";
  // Card widths follow the aspect ratio of their row.
  const cardWidthClass = isBackdrop ? "w-[268px]" : "w-[184px]";

  // Resolve the row heading copy so the scroll region's accessible name is translated.
  const copy = ROW_COPY[row.kind];
  const headerFn = m[copy.headerKey] as (params?: Record<string, string>) => string;
  const ariaLabel = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className="snap-x snap-proximity overflow-x-auto pb-3"
    >
      <div className="flex gap-3 ps-0.5">
        {row.items.length === 0
          ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className={`flex shrink-0 snap-start flex-col gap-2 ${cardWidthClass}`}
              >
                <Skeleton
                  className={
                    isBackdrop ? "aspect-video w-full rounded-md" : "aspect-2/3 w-full rounded-md"
                  }
                />
                <Skeleton className="h-3 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
            ))
          : row.items.map((item) => (
              <div key={item.id} className={`shrink-0 snap-start ${cardWidthClass}`}>
                <Card
                  item={item}
                  rowKind={row.kind}
                  isInWatchlist={watchlist?.has(item.id) ?? false}
                  onWatchlistToggle={() => onWatchlistToggle?.(item.id)}
                  onRequest={() => onRequest?.(item.id)}
                />
              </div>
            ))}
      </div>
    </div>
  );
}
