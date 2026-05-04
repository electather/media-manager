import type { KeyboardEvent } from "react";
import { Skeleton } from "@/shared/ui/skeleton";
import { Card } from "../card/index";
import type { RowData } from "../../lib/types";

/** Number of skeleton placeholder cards to show while content loads. */
const SKELETON_COUNT = 5;

interface RowScrollerProps {
  row: RowData;
  onWatchlistToggle?: (id: string) => void;
  onRequest?: (id: string) => void;
}

/** Renders a horizontally scrollable list of cards, or skeleton placeholders when empty. */
export function RowScroller({ row, onWatchlistToggle, onRequest }: RowScrollerProps) {
  const isBackdrop = row.defaultAspect === "16/9";
  // Card widths follow the aspect ratio of their row.
  const cardWidthClass = isBackdrop ? "w-[268px]" : "w-[184px]";

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      el.scrollBy({ left: 200, behavior: "smooth" });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      el.scrollBy({ left: -200, behavior: "smooth" });
    }
  }

  return (
    <div
      role="region"
      aria-label={row.kind}
      className="flex gap-3 overflow-x-auto pb-3 ps-0.5 focus-visible:outline-none"
      style={{ scrollSnapType: "x proximity" }}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {row.items.length === 0
        ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={`flex shrink-0 flex-col gap-2 ${cardWidthClass}`}
              style={{ scrollSnapAlign: "start" }}
            >
              <Skeleton
                className={
                  isBackdrop ? "aspect-video w-full rounded-md" : "aspect-[2/3] w-full rounded-md"
                }
              />
              <Skeleton className="h-3 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          ))
        : row.items.map((item) => (
            <div
              key={item.id}
              className={`shrink-0 ${cardWidthClass}`}
              style={{ scrollSnapAlign: "start" }}
            >
              <Card
                item={item}
                rowKind={row.kind}
                onWatchlistToggle={() => onWatchlistToggle?.(item.id)}
                onRequest={() => onRequest?.(item.id)}
              />
            </div>
          ))}
    </div>
  );
}
