import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { extendInvite } from "../lib/fetchers";
import { adminInvitesKeys } from "../lib/query-keys";
import { AdminUsersApiError } from "../lib/types";

interface Vars {
  id: string;
  expiresAt: number;
}

export function useExtendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expiresAt }: Vars) => extendInvite(id, expiresAt),
    onError: (err) => {
      toast.error(err instanceof AdminUsersApiError ? err.message : String(err));
    },
    onSuccess: () => {
      toast.success(m.admin_users_invite_toast_extended());
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminInvitesKeys.list() });
    },
  });
}
