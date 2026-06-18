import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/shared/lib/diagnostics/api-error";
import { createInvite } from "../lib/fetchers";
import { adminInvitesKeys } from "../lib/query-keys";

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
      toast.error(errorMessage(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminInvitesKeys.list() });
    },
  });
}
