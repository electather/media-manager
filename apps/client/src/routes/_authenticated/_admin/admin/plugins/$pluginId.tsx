import { Suspense } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import {
  AdminPluginsErrorBoundary,
  AdminPluginsErrorFallback,
  PluginDetailPage,
  PluginsListSkeleton,
  type PluginDetailTab,
} from "@/features/admin-plugins";

const TABS = ["overview", "configuration", "security", "shared"] as const;

const searchSchema = z
  .object({
    tab: z.enum(TABS).optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_admin/admin/plugins/$pluginId")({
  component: AdminPluginDetailRoute,
  errorComponent: AdminPluginsErrorFallback,
  validateSearch: (search) => searchSchema.parse(search),
});

function AdminPluginDetailRoute() {
  const { pluginId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const activeTab: PluginDetailTab = tab ?? "overview";
  return (
    <AdminPluginsErrorBoundary>
      <Suspense fallback={<PluginsListSkeleton />}>
        <PluginDetailPage
          pluginId={pluginId}
          tab={activeTab}
          onTabChange={(next) =>
            void navigate({
              search: (prev) => ({ ...prev, tab: next === "overview" ? undefined : next }),
              replace: true,
            })
          }
        />
      </Suspense>
    </AdminPluginsErrorBoundary>
  );
}
