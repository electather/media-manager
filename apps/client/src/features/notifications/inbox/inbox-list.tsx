import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { m } from "@/paraglide/messages";
import { InboxRow } from "./inbox-row";
import { InboxEmpty } from "./inbox-empty";
import { useInbox } from "./use-inbox";
import { categoryLabel } from "../shared/types";
import type { InboxFilters, NotificationItemDto } from "../shared/types";

interface Props {
  filters: InboxFilters;
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string, selected: boolean) => void;
}

export function InboxList({ filters, selected, onToggleSelect }: Props) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInbox(filters);
  const items = useMemo<NotificationItemDto[]>(
    () => data.pages.flatMap((p) => p.items as NotificationItemDto[]),
    [data.pages],
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = items.length + (hasNextPage ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 6,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];

  useEffect(() => {
    if (!lastItem) return;
    if (lastItem.index >= items.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [lastItem, items.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (items.length === 0) {
    const filterLabel = filters.category ? categoryLabel(filters.category) : null;
    return <InboxEmpty filterLabel={filterLabel} />;
  }

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto" role="list">
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
      >
        {virtualItems.map((vi) => {
          const isSentinel = vi.index >= items.length;
          const item = items[vi.index];
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {isSentinel ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  {isFetchingNextPage ? m.notifications_loading() : ""}
                </div>
              ) : item ? (
                <InboxRow
                  item={item}
                  selected={selected.has(item.id)}
                  onToggleSelect={onToggleSelect}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
