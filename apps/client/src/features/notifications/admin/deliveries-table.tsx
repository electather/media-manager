import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { AdminDeliveryRow } from "@nama/shared/notifications";
import { m } from "@/paraglide/messages";
import { PaginationSlot, usePaginationSlot } from "@/shared/components/virtualized";
import { useAdminDeliveries } from "./use-admin-deliveries";
import { DeliveryRow } from "./delivery-row";
import type { AdminDeliveryFilters } from "../shared/types";

interface Props {
  filters: AdminDeliveryFilters;
  onSelect: (id: string) => void;
}

/** One delivery row, or nothing when the virtual index outran the loaded page. */
function DeliveryRowSlot({
  delivery,
  onSelect,
}: {
  delivery: AdminDeliveryRow | undefined;
  onSelect: (id: string) => void;
}) {
  if (!delivery) return null;
  return <DeliveryRow delivery={delivery} onClick={onSelect} />;
}

// fallow-ignore-next-line complexity
export function DeliveriesTable({ filters, onSelect }: Props) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, error } =
    useAdminDeliveries(filters);
  const items = useMemo<AdminDeliveryRow[]>(
    () =>
      data.pages.flatMap((p) => ("deliveries" in p ? (p.deliveries as AdminDeliveryRow[]) : [])),
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
  // Trailing slot row exists when a next page exists OR an append page failed
  // (#888); the failed case keeps `hasNextPage` but must surface a retry.
  const rowCount = items.length + (hasNextPage || slot.state !== "none" ? 1 : 0);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];
  const nearEnd = lastItem !== undefined && lastItem.index >= items.length - 1;
  const shouldLoad = nearEnd && hasNextPage && !isFetchingNextPage;

  useEffect(() => {
    if (shouldLoad) void fetchNextPage();
  }, [shouldLoad, fetchNextPage]);

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
              <DeliveryRowSlot delivery={items[vi.index]} onSelect={onSelect} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
