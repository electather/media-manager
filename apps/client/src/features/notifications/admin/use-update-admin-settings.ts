import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AdminSettingsBody } from "@ent-mcp/shared/notifications";
import { m } from "@/paraglide/messages";
import { fetchUpdateAdminSettings } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import { NotificationsApiError } from "../shared/types";

export function useUpdateAdminSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminSettingsBody) => fetchUpdateAdminSettings(body),
    onSuccess: (response) => {
      qc.setQueryData(notificationsKeys.admin.settings(), {
        inboxRetentionDays: response.inboxRetentionDays,
        deliveryRetentionDays: response.deliveryRetentionDays,
      });
      toast.success(m.notifications_admin_settings_saved());
    },
    onError: (err) => {
      const msg =
        err instanceof NotificationsApiError && err.body?.message ? err.body.message : err.message;
      toast.error(`${m.notifications_admin_settings_save_failed()}: ${msg}`);
    },
  });
}
