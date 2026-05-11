import { Suspense } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";

import { RolesPage, RolesSkeleton } from "@/features/admin-roles";
import { adminUsersKeys, fetchAdminUsers } from "@/features/admin-users";

const searchSchema = z
  .object({
    role: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_admin/admin/roles")({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: adminUsersKeys.list(),
      queryFn: fetchAdminUsers,
    }),
  component: AdminRolesRoute,
});

function AdminRolesRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const selectedRoleId = search.role ?? null;

  const onSelectRole = (id: string | null) =>
    void navigate({ to: Route.fullPath, search: id ? { role: id } : {} });

  return (
    <SettingsErrorBoundary resetQueryKey={adminUsersKeys.all}>
      <Suspense fallback={<RolesSkeleton />}>
        <RolesPage selectedRoleId={selectedRoleId} onSelectRole={onSelectRole} />
      </Suspense>
    </SettingsErrorBoundary>
  );
}
