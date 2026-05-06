import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { fetchRetryDelivery } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import { NotificationsApiError } from "../shared/types";

export function useRetryDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchRetryDelivery(id),
    onSuccess: () => {
      toast.success(m.notifications_admin_retry_queued());
      void qc.invalidateQueries({ queryKey: notificationsKeys.admin.deliveriesAll() });
    },
    onError: (err) => {
      if (err instanceof NotificationsApiError && err.status === 409) {
        toast.warning(m.notifications_admin_retry_in_flight());
        return;
      }
      const msg =
        err instanceof NotificationsApiError && err.body?.message ? err.body.message : err.message;
      toast.error(msg);
    },
  });
}
