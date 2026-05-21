import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

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
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const sync = () => setScrollMargin(el.offsetTop);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize,
    overscan,
    scrollMargin,
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
                top: 0,
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
