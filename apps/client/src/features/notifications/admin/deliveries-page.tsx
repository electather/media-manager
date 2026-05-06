import { Suspense } from "react";
import { m } from "@/paraglide/messages";
import { DeliveriesFilterBar } from "./deliveries-filter-bar";
import { DeliveriesSkeleton } from "./deliveries-skeleton";
import { DeliveriesTable } from "./deliveries-table";
import { DeliveryDetailDialog } from "./delivery-detail-dialog";
import type { AdminDeliveryFilters } from "../shared/types";

interface Props {
  filters: AdminDeliveryFilters;
  selectedId: string | null;
  onFiltersChange: (next: AdminDeliveryFilters) => void;
  onSelect: (id: string | null) => void;
}

export function DeliveriesPage({ filters, selectedId, onFiltersChange, onSelect }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold">{m.notifications_admin_deliveries_title()}</h1>
      </header>
      <DeliveriesFilterBar filters={filters} onFiltersChange={onFiltersChange} />
      <Suspense fallback={<DeliveriesSkeleton />}>
        <DeliveriesTable filters={filters} onSelect={onSelect} />
      </Suspense>
      <DeliveryDetailDialog id={selectedId} onClose={() => onSelect(null)} />
    </div>
  );
}
