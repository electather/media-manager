import { useRef, type CSSProperties, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEndReached } from "./use-end-reached";
import { useGridColumns } from "./use-grid-columns";
import { useScrollMargin } from "./use-scroll-margin";

interface VirtualGridProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  estimateRowHeight: (rowIndex: number, cols: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  minColumnWidthPx: number;
  gapPx?: number;
  overscanRows?: number;
  className?: string;
  cellClassName?: string;
  style?: CSSProperties;
  /**
   * Fired when the last (overscanned) row enters the rendered window — i.e.
   * the scroll position nears the end of the list. Infinite lists wire this to
   * `fetchNextPage`; the callback itself must guard `hasNextPage` /
   * `isFetchingNextPage` (this only signals proximity, it does not dedupe).
   */
  onEndReached?: () => void;
  /**
   * Trailing pagination slot (loading / append-error + retry) rendered below
   * the grid (#888). Pass `<PaginationSlot variant="row" .../>` — the grid owns
   * where it mounts so every consumer surfaces append failures identically.
   */
  trailingSlot?: ReactNode;
}

/**
 * Window-virtualized responsive grid. Column count tracks
 * `repeat(auto-fill, minmax(minColumnWidthPx, 1fr))` via `useGridColumns`,
 * and the virtualizer's `getItemKey` is salted with the column count so
 * cached row measurements drop when the breakpoint changes.
 */
export function VirtualGrid<T>({
  items,
  getKey,
  estimateRowHeight,
  renderItem,
  minColumnWidthPx,
  gapPx = 16,
  overscanRows = 2,
  className,
  cellClassName,
  style,
  onEndReached,
  trailingSlot,
}: VirtualGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(parentRef);
  const { cols } = useGridColumns(parentRef, { minColumnWidthPx, gapPx });

  const rowCount = Math.ceil(items.length / Math.max(cols, 1));

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: (r) => estimateRowHeight(r, cols),
    overscan: overscanRows,
    scrollMargin,
    getItemKey: (r) => `${cols}:${r}`,
  });

  const virtualRows = virtualizer.getVirtualItems();
  useEndReached(virtualRows, rowCount, onEndReached);

  return (
    <div ref={parentRef} className={className} style={{ display: "block", ...style }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualRows.map((vr) => {
          const start = vr.index * cols;
          const slice = items.slice(start, start + cols);
          return (
            <div
              key={vr.key}
              data-index={vr.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                insetInlineStart: 0,
                insetInlineEnd: 0,
                insetBlockStart: 0,
                transform: `translateY(${vr.start - scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gap: gapPx,
                paddingBottom: gapPx,
              }}
            >
              {slice.map((it, j) => (
                <div key={getKey(it, start + j)} className={cellClassName}>
                  {renderItem(it, start + j)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {trailingSlot}
    </div>
  );
}
