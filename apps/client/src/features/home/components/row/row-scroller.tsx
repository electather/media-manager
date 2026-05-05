import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/ui/skeleton";
import { ROW_COPY } from "../../lib/home-feed-config";
import {
  generateMockPage,
  MAX_MOCK_ITEMS,
  MOCK_PAGE_SIZE,
  PREFETCH_THRESHOLD,
} from "../../lib/mock-pagination";
import type { HomeMediaItem, RowData } from "../../lib/types";
import { Card } from "../card/index";

const SKELETON_COUNT = 5;
// Account for the leading padding so "at start" reads as canPrev=false.
const START_SLACK_PX = 32;

interface RowScrollerProps {
  row: RowData;
  watchlist?: ReadonlySet<string>;
  onWatchlistToggle?: (id: string) => void;
  onCardClick?: (id: string) => void;
}

/**
 * Horizontally scrollable row with edge fades, hover-revealed chevrons, and
 * mock infinite pagination. Native scroll preserves keyboard + touch, so
 * arrows stay out of the tab order and exist only as a pointer affordance.
 */
export function RowScroller({ row, watchlist, onWatchlistToggle, onCardClick }: RowScrollerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isBackdrop = row.defaultAspect === "16/9";
  const cardWidthClass = isBackdrop ? "w-[268px]" : "w-[184px]";
  const cardWidthPx = isBackdrop ? 268 : 184;
  const gapPx = 12;

  const copy = ROW_COPY[row.kind];
  const headerFn = m[copy.headerKey] as (params?: Record<string, string>) => string;
  const ariaLabel = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});
  const prevLabel = m.home_row_prev_label({ row: ariaLabel });
  const nextLabel = m.home_row_next_label({ row: ariaLabel });

  const [items, setItems] = useState<HomeMediaItem[]>(row.items);
  const [exhausted, setExhausted] = useState(row.items.length === 0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  // Reset when the row data flips (e.g. data refresh).
  useEffect(() => {
    setItems(row.items);
    setExhausted(row.items.length === 0);
  }, [row.id, row.items]);

  const triggerPx = useMemo(
    () => (cardWidthPx + gapPx) * PREFETCH_THRESHOLD,
    [cardWidthPx, gapPx],
  );

  const loadMore = useCallback(() => {
    if (exhausted) return;
    setItems((prev) => {
      if (prev.length >= MAX_MOCK_ITEMS) {
        setExhausted(true);
        return prev;
      }
      const more = generateMockPage(prev, MOCK_PAGE_SIZE);
      const next = prev.concat(more).slice(0, MAX_MOCK_ITEMS);
      if (next.length >= MAX_MOCK_ITEMS) setExhausted(true);
      return next;
    });
  }, [exhausted]);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanPrev(el.scrollLeft > START_SLACK_PX);
    setCanNext(el.scrollLeft < max - START_SLACK_PX);
    if (max - el.scrollLeft < triggerPx) loadMore();
  }, [loadMore, triggerPx]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  // Re-run after items grow so canNext refreshes without waiting for scroll.
  useEffect(() => {
    update();
  }, [items.length, update]);

  function scrollByDir(dir: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: Math.round(el.clientWidth * 0.85) * dir, behavior: "smooth" });
  }

  return (
    <div className="group/row relative" data-testid="row-scroller">
      <div
        ref={trackRef}
        role="region"
        aria-label={ariaLabel}
        className="snap-x snap-proximity overflow-x-auto pb-3 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex gap-3 ps-0.5">
          {items.length === 0 ? (
            Array.from({ length: SKELETON_COUNT }, (_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className={cn("flex shrink-0 snap-start flex-col gap-2", cardWidthClass)}
              >
                <Skeleton
                  className={cn(
                    isBackdrop
                      ? "aspect-video w-full rounded-md"
                      : "aspect-[2/3] w-full rounded-md",
                  )}
                />
                <Skeleton className="h-3 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
            ))
          ) : (
            items.map((item) => (
              <div key={item.id} className={cn("shrink-0 snap-start", cardWidthClass)}>
                <Card
                  item={item}
                  rowKind={row.kind}
                  isInWatchlist={watchlist?.has(item.id) ?? false}
                  onWatchlistToggle={() => onWatchlistToggle?.(item.id)}
                  onClick={() => onCardClick?.(item.id)}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <div
        aria-hidden="true"
        data-visible={canPrev ? "true" : "false"}
        data-testid="row-fade-start"
        className="pointer-events-none absolute inset-y-0 start-0 z-[5] w-12 bg-gradient-to-r from-background to-transparent opacity-0 transition-opacity duration-200 data-[visible=true]:opacity-100"
      />
      <div
        aria-hidden="true"
        data-visible={canNext ? "true" : "false"}
        data-testid="row-fade-end"
        className="pointer-events-none absolute inset-y-0 end-0 z-[5] w-12 bg-gradient-to-l from-background to-transparent opacity-0 transition-opacity duration-200 data-[visible=true]:opacity-100"
      />

      <button
        type="button"
        aria-label={prevLabel}
        tabIndex={-1}
        disabled={!canPrev}
        onClick={() => scrollByDir(-1)}
        className="absolute start-2 top-1/2 z-20 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/85 text-foreground opacity-0 backdrop-blur-md transition-opacity duration-150 hover:bg-card disabled:cursor-not-allowed disabled:opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        tabIndex={-1}
        disabled={!canNext}
        onClick={() => scrollByDir(1)}
        className="absolute end-2 top-1/2 z-20 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/85 text-foreground opacity-0 backdrop-blur-md transition-opacity duration-150 hover:bg-card disabled:cursor-not-allowed disabled:opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
