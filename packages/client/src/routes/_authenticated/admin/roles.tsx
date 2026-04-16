import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/roles")({
  component: AdminRolesPage,
});

/** Gated by admin:roles permission. */
function AdminRolesPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Roles</h1>
      <p className="text-muted-foreground">
        Role and permission management. Lists all roles with permission counts. Create custom roles
        with name and description. Permission editor with grouped toggles by domain (Media, Account,
        Admin) — system roles show locked permissions. Deleting a role requires reassigning its
        users first.
      </p>
    </div>
  );
}
