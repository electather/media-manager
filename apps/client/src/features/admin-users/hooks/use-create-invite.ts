import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createInvite } from "../lib/fetchers";
import { adminInvitesKeys } from "../lib/query-keys";
import { AdminUsersApiError } from "../lib/types";

interface Vars {
  roleId: string;
  expiresAt: number;
  /** Raw string from the select; coerced to number before sending. */
  maxUses: string;
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, expiresAt, maxUses }: Vars) =>
      createInvite({ roleId, expiresAt, maxUses: Number(maxUses) }),
    onError: (err) => {
      toast.error(err instanceof AdminUsersApiError ? err.message : String(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminInvitesKeys.list() });
    },
  });
}
