import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
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
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: adminUsersKeys.list() });
      const prev = qc.getQueryData<ListSnapshot>(adminUsersKeys.list());
      qc.setQueryData<ListSnapshot>(adminUsersKeys.list(), (data) =>
        data ? { users: data.users.filter((u) => u.id !== userId) } : data,
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(adminUsersKeys.list(), ctx.prev);
      toast.error(err instanceof AdminUsersApiError ? err.message : String(err));
    },
    onSuccess: () => toast.success(m.admin_users_detail_delete_toast()),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminUsersKeys.list() });
    },
  });
}
