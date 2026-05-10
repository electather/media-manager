import { createFileRoute } from "@tanstack/react-router";

import { AdminIndex } from "@/app/admin-layout";

export const Route = createFileRoute("/_authenticated/_admin/admin/")({
  component: AdminIndex,
});
