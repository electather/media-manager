import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_settings/admin/users")({
  component: AdminUsersPage,
});

/** Gated by admin:users permission. */
function AdminUsersPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Users</h1>
      <p className="text-muted-foreground">
        User management. Table of all users with name, email, role, status, last active, and
        connected services count. Actions: invite new user (generates a link with expiry), assign or
        change role per user, and disable or remove a user.
      </p>
    </div>
  );
}
