import { useCallback, useRef, type CSSProperties } from "react";
import * as m from "@/paraglide/messages";
import { useHomeRow } from "../../hooks/use-home-row";
import { ROW_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem, RowData } from "../../lib/types";
import { RowChevron } from "./row-chevron";
import { RowError } from "./row-error";
import { RowItem } from "./row-item";
import { RowSkeletonItem } from "./row-skeleton-item";
import { usePrefetchObserver } from "./use-prefetch-observer";
import { useRowEdges } from "./use-row-edges";

const SKELETON_COUNT = 5;
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
 * Edge tracking + prefetch observer wiring live in sibling hooks
 * (`use-row-edges`, `use-prefetch-observer`); this file owns composition,
 * label resolution, and skeleton-vs-items branching only.
 */
export function RowScroller({ row, watchlist, onWatchlistToggle, onCardClick }: RowScrollerProps) {
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const isBackdrop = row.defaultAspect === "16/9";
  const cardVars = isBackdrop ? BACKDROP_VARS : POSTER_VARS;

  const copy = ROW_COPY[row.kind];
  const headerFn = m[row.headerKey ?? copy.headerKey] as (
    params?: Record<string, string>,
  ) => string;
  const ariaLabel = headerFn(row.seedTitle ? { seedTitle: row.seedTitle } : {});
  const prevLabel = m.home_row_prev_label({ row: ariaLabel });
  const nextLabel = m.home_row_next_label({ row: ariaLabel });

  const { items, fetchNextPage, hasNextPage, isLoading, error, refetch, isRefetching } = useHomeRow(
    row.id,
    row.initialCursor,
  );
  const { trackRef, attachTrack, attachPrefetch } = usePrefetchObserver({
    hasNextPage,
    fetchNextPage,
  });
  useRowEdges(trackRef, scopeRef, items.length);

  const scrollByDir = useCallback(
    (dir: -1 | 1) => {
      const el = trackRef.current;
      if (!el) return;
      el.scrollBy({ left: Math.round(el.clientWidth * 0.85) * dir, behavior: "smooth" });
    },
    [trackRef],
  );

  const showError = error !== null && items.length === 0;
  const showSkeletons = !showError && isLoading && items.length === 0;
  const prefetchIndex = items.length === 0 ? -1 : Math.max(0, items.length - PREFETCH_OFFSET);

  if (showError) {
    return (
      <div ref={scopeRef} className="row-track-scope" data-testid="row-scroller" style={cardVars}>
        <RowError error={error} onRetry={() => refetch()} isRetrying={isRefetching} />
      </div>
    );
  }

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
