import { Suspense } from "react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Skeleton } from "@/shared/ui/skeleton";
import { m } from "@/paraglide/messages";
import { useAdminDelivery } from "./use-admin-delivery";
import { useRetryDelivery } from "./use-retry-delivery";
import { DeliveryStatusBadge } from "./delivery-status-badge";

interface Props {
  id: string | null;
  onClose: () => void;
}

function DetailContent({ id }: { id: string }) {
  const { data } = useAdminDelivery(id);
  const retry = useRetryDelivery();
  const delivery = data.delivery;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{delivery.eventType}</DialogTitle>
        <DialogDescription>
          <DeliveryStatusBadge status={delivery.status} />
          <span className="ml-2 text-xs">
            {m.notifications_admin_detail_attempts({ count: delivery.attemptCount })}
          </span>
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4 py-2">
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            {m.notifications_admin_detail_payload()}
          </h3>
          <pre className="max-h-72 overflow-auto rounded border border-border bg-muted/40 p-3 text-xs">
            {JSON.stringify(delivery.eventPayload, null, 2)}
          </pre>
        </section>
        {delivery.lastError && (
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
              {m.notifications_admin_detail_last_error()}
            </h3>
            <pre className="rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {delivery.lastError}
            </pre>
          </section>
        )}
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          disabled={retry.isPending}
          onClick={() => retry.mutate(delivery.id)}
        >
          {m.notifications_admin_retry()}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DeliveryDetailDialog({ id, onClose }: Props) {
  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {id ? (
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <DetailContent id={id} />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
