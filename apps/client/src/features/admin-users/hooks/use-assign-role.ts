import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { fetchAssignRole } from "../lib/fetchers";
import { adminUsersKeys } from "../lib/query-keys";
import type { AdminUserSummary } from "../lib/types";
import { AdminUsersApiError } from "../lib/types";

interface Vars {
  userId: string;
  roleId: string;
  roleName: string;
}

interface ListSnapshot {
  users: AdminUserSummary[];
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: Vars) => fetchAssignRole(userId, roleId),
    onMutate: async ({ userId, roleId, roleName }) => {
      await qc.cancelQueries({ queryKey: adminUsersKeys.list() });
      const prev = qc.getQueryData<ListSnapshot>(adminUsersKeys.list());
      qc.setQueryData<ListSnapshot>(adminUsersKeys.list(), (data) =>
        data
          ? {
              users: data.users.map((u) =>
                u.id === userId ? { ...u, role: { id: roleId, name: roleName } } : u,
              ),
            }
          : data,
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(adminUsersKeys.list(), ctx.prev);
      toast.error(err instanceof AdminUsersApiError ? err.message : String(err));
    },
    onSuccess: (_data, { roleName }) => {
      toast.success(m.admin_users_detail_role_toast({ name: roleName }));
    },
    onSettled: (_data, _err, { userId }) => {
      void qc.invalidateQueries({ queryKey: adminUsersKeys.list() });
      void qc.invalidateQueries({ queryKey: adminUsersKeys.detail(userId) });
    },
  });
}
