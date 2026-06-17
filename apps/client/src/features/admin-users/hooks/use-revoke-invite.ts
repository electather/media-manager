import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { revokeInvite } from "../lib/fetchers";
import { adminInvitesKeys } from "../lib/query-keys";
import { adminUsersKeys } from "../lib/query-keys";
import { AdminUsersApiError } from "../lib/types";

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeInvite(id),
    onError: (err) => {
      toast.error(err instanceof AdminUsersApiError ? err.message : String(err));
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
