import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { m } from "@/paraglide/messages";
import { errorMessage } from "@/shared/lib/diagnostics/api-error";
import { rollbackQuery, snapshotQuery } from "@/shared/lib/query/optimistic";
import { fetchAssignRole } from "../lib/fetchers";
import { adminUsersKeys } from "../lib/query-keys";
import type { AdminUserDetail, AdminUserSummary } from "../lib/types";

interface Vars {
  userId: string;
  roleId: string;
  roleName: string;
}

interface ListSnapshot {
  users: AdminUserSummary[];
}

interface DetailSnapshot {
  user: AdminUserDetail;
}

export function useAssignRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId }: Vars) => fetchAssignRole(userId, roleId),
    onMutate: async ({ userId, roleId, roleName }) => {
      const role = { id: roleId, name: roleName };
      // Patch the list and the detail query simultaneously so both surfaces
      // reflect the new role immediately while the request is in flight.
      const [listCtx, detailCtx] = await Promise.all([
        snapshotQuery<ListSnapshot>(qc, adminUsersKeys.list(), (data) =>
          data
            ? {
                users: data.users.map((u) => (u.id === userId ? { ...u, role } : u)),
              }
            : data,
        ),
        snapshotQuery<DetailSnapshot>(qc, adminUsersKeys.detail(userId), (data) =>
          data ? { user: { ...data.user, role } } : data,
        ),
      ]);
      return { listCtx, detailCtx };
    },
    onError: (err, { userId }, ctx) => {
      if (ctx?.listCtx.prev) rollbackQuery(qc, adminUsersKeys.list(), ctx.listCtx.prev);
      if (ctx?.detailCtx.prev) rollbackQuery(qc, adminUsersKeys.detail(userId), ctx.detailCtx.prev);
      toast.error(errorMessage(err));
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
