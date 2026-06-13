import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AdminDeliveryRow } from "@nama/shared/notifications";
import { m } from "@/paraglide/messages";
import { useAdminDeliveries } from "./use-admin-deliveries";
import { DeliveryRow } from "./delivery-row";
import type { AdminDeliveryFilters } from "../shared/types";

interface Props {
  filters: AdminDeliveryFilters;
  onSelect: (id: string) => void;
}

export function DeliveriesTable({ filters, onSelect }: Props) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useAdminDeliveries(filters);
  const items = useMemo<AdminDeliveryRow[]>(
    () =>
      data.pages.flatMap((p) => ("deliveries" in p ? (p.deliveries as AdminDeliveryRow[]) : [])),
    [data.pages],
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = items.length + (hasNextPage ? 1 : 0);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 8,
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
    return (
      <div className="px-4 py-12 text-center text-sm text-muted-foreground">
        {m.notifications_admin_deliveries_empty()}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
      >
        {virtualItems.map((vi) => {
          const isSentinel = vi.index >= items.length;
          const d = items[vi.index];
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
                <div className="px-4 py-3 text-center text-xs text-muted-foreground">
                  {isFetchingNextPage ? m.notifications_loading() : ""}
                </div>
              ) : d ? (
                <DeliveryRow delivery={d} onClick={onSelect} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
