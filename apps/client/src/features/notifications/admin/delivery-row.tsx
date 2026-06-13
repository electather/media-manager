import type { AdminDeliveryRow } from "@nama/shared/notifications";
import { DeliveryStatusBadge } from "./delivery-status-badge";

interface Props {
  delivery: AdminDeliveryRow;
  onClick: (id: string) => void;
}

export function DeliveryRow({ delivery, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={() => onClick(delivery.id)}
      className="grid w-full grid-cols-[160px_1fr_180px_140px_120px_60px] items-center gap-3 border-b border-border/50 px-4 py-2 text-left text-sm transition-colors hover:bg-muted/40"
    >
      <span className="tabular-nums text-xs text-muted-foreground">
        {new Date(delivery.createdAt).toISOString().slice(11, 19)}
      </span>
      <span className="truncate font-medium">{delivery.eventType}</span>
      <span className="truncate text-muted-foreground">{delivery.recipientUserId}</span>
      <span className="truncate text-muted-foreground">
        {delivery.recipientConnectionId ?? "—"}
      </span>
      <DeliveryStatusBadge status={delivery.status} />
      <span className="text-right tabular-nums text-xs text-muted-foreground">
        {delivery.attemptCount}
      </span>
    </button>
  );
}
