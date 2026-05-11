import { Suspense } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";

import { adminUsersKeys, fetchAdminUsers, UsersPage, UsersSkeleton } from "@/features/admin-users";

const searchSchema = z
  .object({
    user: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_admin/admin/users")({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: adminUsersKeys.list(),
      queryFn: fetchAdminUsers,
    }),
  component: AdminUsersRoute,
});

function AdminUsersRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const selectedUserId = search.user ?? null;

  const onSelectUser = (id: string | null) =>
    void navigate({ to: Route.fullPath, search: id ? { user: id } : {} });

  return (
    <SettingsErrorBoundary resetQueryKey={adminUsersKeys.all}>
      <Suspense fallback={<UsersSkeleton />}>
        <UsersPage selectedUserId={selectedUserId} onSelectUser={onSelectUser} />
      </Suspense>
    </SettingsErrorBoundary>
  );
}
