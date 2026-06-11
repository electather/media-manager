import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { rollbackQuery, snapshotQuery } from "@/shared/lib/query/optimistic";
import { fetchDeleteUser } from "../lib/fetchers";
import { adminUsersKeys } from "../lib/query-keys";
import { AdminUsersApiError, type AdminUserSummary } from "../lib/types";

interface ListSnapshot {
  users: AdminUserSummary[];
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => fetchDeleteUser(userId),
    onMutate: (userId) =>
      snapshotQuery<ListSnapshot>(qc, adminUsersKeys.list(), (data) =>
        data ? { users: data.users.filter((u) => u.id !== userId) } : data,
      ),
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) rollbackQuery(qc, adminUsersKeys.list(), ctx.prev);
      toast.error(err instanceof AdminUsersApiError ? err.message : String(err));
    },
    onSuccess: () => toast.success(m.admin_users_detail_delete_toast()),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminUsersKeys.list() });
    },
  });
}
