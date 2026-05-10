import { createFileRoute } from "@tanstack/react-router";

import { AdminLayout } from "@/app/admin-layout";

export const Route = createFileRoute("/_authenticated/_admin")({
  component: AdminLayout,
});
