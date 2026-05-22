import { useRef, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useScrollMargin } from "./use-scroll-margin";

interface VirtualWindowListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  estimateSize: (index: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Window-virtualized vertical list. The page itself scrolls; the list caps
 * mounted children to the visible window plus `overscan`. Tracks
 * `parentRef.current.offsetTop` as the virtualizer's `scrollMargin` via a
 * `ResizeObserver(document.body)` so sticky-header / hero-zone resizes don't
 * desync the translateY math.
 */
export function VirtualWindowList<T>({
  items,
  getKey,
  estimateSize,
  renderItem,
  overscan = 4,
  header,
  footer,
  className,
}: VirtualWindowListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(parentRef);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize,
    overscan,
    scrollMargin,
    getItemKey: (i) => {
      const item = items[i];
      return item === undefined ? String(i) : getKey(item, i);
    },
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={parentRef} className={className}>
      {header}
      <div style={{ height: totalSize, position: "relative", width: "100%" }}>
        {virtualItems.map((vi) => {
          const item = items[vi.index];
          if (item === undefined) return null;
          return (
            <div
              key={getKey(item, vi.index)}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                insetInlineStart: 0,
                insetInlineEnd: 0,
                insetBlockStart: 0,
                transform: `translateY(${vi.start - scrollMargin}px)`,
              }}
            >
              {renderItem(item, vi.index)}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}
