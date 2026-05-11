import { Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  AdminPluginsErrorBoundary,
  AdminPluginsErrorFallback,
  PluginsListPage,
  PluginsListSkeleton,
} from "@/features/admin-plugins";

export const Route = createFileRoute("/_authenticated/_admin/admin/plugins/")({
  component: AdminPluginsListRoute,
  errorComponent: AdminPluginsErrorFallback,
});

function AdminPluginsListRoute() {
  return (
    <AdminPluginsErrorBoundary>
      <Suspense fallback={<PluginsListSkeleton />}>
        <PluginsListPage />
      </Suspense>
    </AdminPluginsErrorBoundary>
  );
}
