import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useGridColumns } from "./use-grid-columns";

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
}: VirtualGridProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const { cols } = useGridColumns(parentRef, { minColumnWidthPx, gapPx });

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const sync = () => setScrollMargin(el.offsetTop);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(items.length / Math.max(cols, 1));

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: (r) => estimateRowHeight(r, cols),
    overscan: overscanRows,
    scrollMargin,
    getItemKey: (r) => `${cols}:${r}`,
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className={className} style={{ display: "block" }}>
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
                top: 0,
                transform: `translateY(${vr.start - scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                gap: gapPx,
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
    </div>
  );
}
