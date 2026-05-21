import { createFileRoute, redirect } from "@tanstack/react-router";
import { ADMIN_PERMISSIONS } from "@ent-mcp/shared/auth";
import type { RouterContext } from "@/routes/__root";
import { AdminLayout } from "@/app/admin-layout";

export const Route = createFileRoute("/_authenticated/_admin")({
  beforeLoad({ context }: { context: RouterContext }) {
    const permissions = context.session?.permissions ?? [];
    const hasAdmin = ADMIN_PERMISSIONS.some((p) => permissions.includes(p));
    if (!hasAdmin) throw redirect({ to: "/" });
  },
  component: AdminLayout,
});
