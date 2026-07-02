import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PaginationSlot, usePaginationSlot } from "@/shared/components/virtualized";
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

/** One inbox row, or nothing when the virtual index outran the loaded page. */
function InboxRowSlot({
  item,
  selected,
  onToggleSelect,
}: {
  item: NotificationItemDto | undefined;
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string, selected: boolean) => void;
}) {
  if (!item) return null;
  return <InboxRow item={item} selected={selected.has(item.id)} onToggleSelect={onToggleSelect} />;
}

// fallow-ignore-next-line complexity
export function InboxList({ filters, selected, onToggleSelect }: Props) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, error } = useInbox(filters);
  const items = useMemo<NotificationItemDto[]>(
    () => data.pages.flatMap((p) => p.items as NotificationItemDto[]),
    [data.pages],
  );
  const slot = usePaginationSlot({
    itemCount: items.length,
    hasNextPage,
    isFetchingNextPage,
    error,
    fetchNextPage,
  });
  const parentRef = useRef<HTMLDivElement>(null);
  // Reserve the trailing slot row whenever a next page exists OR an append
  // page failed (#888) — the failed case keeps `hasNextPage` but must still
  // surface a retry instead of silently swallowing the error.
  const rowCount = items.length + (hasNextPage || slot.state !== "none" ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 6,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];
  const nearEnd = lastItem !== undefined && lastItem.index >= items.length - 1;
  // `error == null` stops the auto-load from re-firing after an append failure:
  // otherwise it would clobber the retry slot with a fresh fetch every render (#888).
  const shouldLoad = nearEnd && hasNextPage && !isFetchingNextPage && error == null;

  useEffect(() => {
    if (shouldLoad) void fetchNextPage();
  }, [shouldLoad, fetchNextPage]);

  if (items.length === 0) {
    const filterLabel = filters.category ? categoryLabel(filters.category) : null;
    return <InboxEmpty filterLabel={filterLabel} />;
  }

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto" role="list">
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
      >
        {virtualItems.map((vi) => (
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
            {vi.index >= items.length ? (
              <PaginationSlot slot={slot} variant="row" />
            ) : (
              <InboxRowSlot
                item={items[vi.index]}
                selected={selected}
                onToggleSelect={onToggleSelect}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
