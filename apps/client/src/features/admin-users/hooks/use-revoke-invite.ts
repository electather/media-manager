import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { errorMessage } from "@/shared/lib/diagnostics/api-error";
import { revokeInvite } from "../lib/fetchers";
import { adminInvitesKeys, adminUsersKeys } from "../lib/query-keys";

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeInvite(id),
    onError: (err) => {
      toast.error(errorMessage(err));
    },
    onSuccess: () => {
      toast.success(m.admin_users_invite_toast_revoked());
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminInvitesKeys.list() });
      // Invalidate user counts which include the pending invite count.
      void qc.invalidateQueries({ queryKey: adminUsersKeys.list() });
    },
  });
}
