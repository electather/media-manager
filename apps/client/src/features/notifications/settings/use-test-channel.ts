import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { fetchTestChannel } from "../shared/fetchers";
import { NotificationsApiError } from "../shared/types";

export function useTestChannel() {
  return useMutation({
    mutationFn: (connectionId: string) => fetchTestChannel(connectionId),
    onSuccess: () => {
      toast.success(m.notifications_settings_test_ok_toast());
    },
    onError: (err) => {
      const msg =
        err instanceof NotificationsApiError && err.body?.message ? err.body.message : err.message;
      toast.error(m.notifications_settings_test_fail_toast({ message: msg }));
    },
  });
}
