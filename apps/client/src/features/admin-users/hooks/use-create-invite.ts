import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createInvite } from "../lib/fetchers";
import { adminInvitesKeys, adminUsersKeys } from "../lib/query-keys";
import { AdminUsersApiError } from "../lib/types";

interface Vars {
  roleId: string;
  expiresAt: number;
  maxUses: string;
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Vars) => createInvite(vars),
    onError: (err) => {
      toast.error(err instanceof AdminUsersApiError ? err.message : String(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminInvitesKeys.list() });
      // Pending count in the users list header derives from the invite list.
      void qc.invalidateQueries({ queryKey: adminUsersKeys.list() });
    },
  });
}
