import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { errorMessage } from "@/shared/lib/diagnostics/api-error";
import { extendInvite } from "../lib/fetchers";
import { adminInvitesKeys } from "../lib/query-keys";

interface Vars {
  id: string;
  expiresAt: number;
}

export function useExtendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expiresAt }: Vars) => extendInvite(id, expiresAt),
    onError: (err) => {
      toast.error(errorMessage(err));
    },
    onSuccess: () => {
      toast.success(m.admin_users_invite_toast_extended());
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminInvitesKeys.list() });
    },
  });
}
