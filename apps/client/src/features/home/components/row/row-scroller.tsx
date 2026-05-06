import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { Skeleton } from "@/shared/ui/skeleton";
import { useHomeRow } from "../../hooks/use-home-row";
import { ROW_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem, RowData, RowKind } from "../../lib/types";
import { Card } from "../card/index";

const SKELETON_COUNT = 5;
const EDGE_SLACK_PX = 8;
const PREFETCH_OFFSET = 4;

interface RowScrollerProps {
  row: RowData;
  watchlist?: ReadonlySet<string>;
  /** Stable id-receiving handler. */
  onWatchlistToggle?: (id: string) => void;
  /** Stable id-receiving handler. */
  onCardClick?: (id: string) => void;
}

interface CardWidthVars extends CSSProperties {
  "--card-w": string;
  "--card-h": string;
}

const BACKDROP_VARS: CardWidthVars = { "--card-w": "268px", "--card-h": "200px" };
const POSTER_VARS: CardWidthVars = { "--card-w": "184px", "--card-h": "326px" };

/**
 * Horizontally scrollable row with edge fades, hover-revealed chevrons, and
 * server-driven infinite pagination via `useHomeRow`. Native scroll
 * preserves keyboard + touch, so arrows stay out of the tab order and exist
 * only as a pointer affordance.
 *
 * Edge fades toggle via `data-at-start` / `data-at-end` data attrs on the
 * scope, set by an rAF-throttled scroll listener. A sentinel `<li>` placed
 * `PREFETCH_OFFSET` cards before the end fires `fetchNextPage` while the
 * user is mid-scroll so the next page mounts before the last card lands.
 */
export function RowScroller({ row, watchlist, onWatchlistToggle, onCardClick }: RowScrollerProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const prefetchElRef = useRef<HTMLLIElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isBackdrop = row.defaultAspect === "16/9";
  const cardVars = isBackdrop ? BACKDROP_VARS : POSTER_VARS;

  const copy = ROW_COPY[row.kind];
  const headerFn = m[row.headerKey ?? copy.headerKey] as (
    params?: Record<string, string>,
  ) => string;
  const ariaLabel = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});
  const prevLabel = m.home_row_prev_label({ row: ariaLabel });
  const nextLabel = m.home_row_next_label({ row: ariaLabel });

  const { items, fetchNextPage, hasNextPage, isLoading } = useHomeRow(row.id, row.initialCursor);

  // Edge tracking: rAF-throttled scroll + ResizeObserver toggles two data
  // attrs on the scope. Re-runs when items grow so scrollWidth changes are
  // picked up immediately. RTL is handled by the browser flipping
  // scrollLeft sign; abs() normalises it.
  useEffect(() => {
    const track = trackRef.current;
    const scope = scopeRef.current;
    if (!track || !scope) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const max = track.scrollWidth - track.clientWidth;
      const x = Math.abs(track.scrollLeft);
      scope.dataset.atStart = String(x <= EDGE_SLACK_PX);
      scope.dataset.atEnd = String(max <= 0 || x >= max - EDGE_SLACK_PX);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };

    update();
    track.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(track);

    return () => {
      track.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [items.length]);

  const wireObserver = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const track = trackRef.current;
    const sentinel = prefetchElRef.current;
    if (!track || !sentinel || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) fetchNextPage();
      },
      { root: track, threshold: 0 },
    );
    io.observe(sentinel);
    observerRef.current = io;
  }, [fetchNextPage, hasNextPage]);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const attachTrack = useCallback(
    (el: HTMLDivElement | null) => {
      trackRef.current = el;
      wireObserver();
    },
    [wireObserver],
  );

  const attachPrefetch = useCallback(
    (el: HTMLLIElement | null) => {
      prefetchElRef.current = el;
      wireObserver();
    },
    [wireObserver],
  );

  const scrollByDir = useCallback((dir: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: Math.round(el.clientWidth * 0.85) * dir, behavior: "smooth" });
  }, []);

  const showSkeletons = isLoading && items.length === 0;
  const prefetchIndex = items.length === 0 ? -1 : Math.max(0, items.length - PREFETCH_OFFSET);

  return (
    <div
      ref={scopeRef}
      className="group/row row-track-scope relative"
      data-testid="row-scroller"
      data-at-start="true"
      data-at-end="true"
      style={cardVars}
    >
      <div
        ref={attachTrack}
        role="region"
        aria-label={ariaLabel}
        className="row-track snap-x snap-proximity scroll-px-8 overflow-x-auto overscroll-x-contain pb-3"
      >
        <ul role="list" className="m-0 flex list-none gap-3 p-0 ps-0.5">
          {showSkeletons
            ? Array.from({ length: SKELETON_COUNT }, (_, i) => (
                <RowSkeletonItem key={`skeleton-${i}`} isBackdrop={isBackdrop} />
              ))
            : items.map((item, index) => (
                <RowItem
                  key={item.id}
                  id={item.id}
                  rowKind={row.kind}
                  isInWatchlist={watchlist?.has(item.id) ?? false}
                  onWatchlistToggle={onWatchlistToggle}
                  onClick={onCardClick}
                  item={item as HomeMediaItem}
                  ref={index === prefetchIndex ? attachPrefetch : undefined}
                />
              ))}
        </ul>
      </div>

      <RowChevron direction="prev" ariaLabel={prevLabel} onClick={() => scrollByDir(-1)} />
      <RowChevron direction="next" ariaLabel={nextLabel} onClick={() => scrollByDir(1)} />
    </div>
  );
}

interface RowItemProps {
  id: string;
  rowKind: RowKind;
  isInWatchlist: boolean;
  onWatchlistToggle?: (id: string) => void;
  onClick?: (id: string) => void;
  item: Parameters<typeof Card>[0]["item"];
  ref?: (el: HTMLLIElement | null) => void;
}

function RowItem({
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

function RowSkeletonItem({ isBackdrop }: { isBackdrop: boolean }) {
  return (
    <li
      aria-hidden="true"
      className="flex shrink-0 snap-start flex-col gap-2"
      style={{ width: "var(--card-w)" }}
    >
      <Skeleton className={cn("w-full rounded-md", isBackdrop ? "aspect-video" : "aspect-2/3")} />
      <Skeleton className="h-3 w-3/4 rounded" />
      <Skeleton className="h-3 w-1/2 rounded" />
    </li>
  );
}

interface RowChevronProps {
  direction: "prev" | "next";
  ariaLabel: string;
  onClick: () => void;
}

function RowChevron({ direction, ariaLabel, onClick }: RowChevronProps) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        direction === "prev" ? "row-prev inset-s-2" : "row-next inset-e-2",
        "absolute top-1/2 z-20 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/85 text-foreground backdrop-blur-md transition-opacity duration-150 hover:bg-card",
        "[@media(hover:hover)]:inline-flex",
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
