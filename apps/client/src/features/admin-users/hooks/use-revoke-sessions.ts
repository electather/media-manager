import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { errorMessage } from "@/shared/lib/diagnostics/api-error";
import { fetchRevokeSessions } from "../lib/fetchers";
import { adminUsersKeys } from "../lib/query-keys";

export function useRevokeSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => fetchRevokeSessions(userId),
    onError: (err) => toast.error(errorMessage(err)),
    onSuccess: () => toast.success(m.admin_users_detail_sessions_toast()),
    onSettled: (_data, _err, userId) => {
      void qc.invalidateQueries({ queryKey: adminUsersKeys.detail(userId) });
    },
  });
}
