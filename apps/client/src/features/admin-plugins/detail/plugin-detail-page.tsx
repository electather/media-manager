import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { m } from "@/paraglide/messages";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty";
import { Button } from "@/shared/ui/button";

import { PluginDetailHeader } from "./plugin-detail-header";
import { UninstallDialog } from "./uninstall-dialog";
import { ConfigurationTab } from "./tabs/configuration-tab";
import { OverviewTab } from "./tabs/overview-tab";
import { SecurityTab } from "./tabs/security-tab";
import { SharedCredentialsTab } from "./tabs/shared-credentials-tab";
import { usePlugin } from "./use-plugin";
import { useUpdateFallback } from "./use-update-fallback";
import { useTogglePlugin } from "../list/use-toggle-plugin";

export type PluginDetailTab = "overview" | "configuration" | "security" | "shared";

interface PluginDetailPageProps {
  pluginId: string;
  tab: PluginDetailTab;
  onTabChange: (tab: PluginDetailTab) => void;
}

// fallow-ignore-next-line complexity
export function PluginDetailPage({ pluginId, tab, onTabChange }: PluginDetailPageProps) {
  const { data: plugin } = usePlugin(pluginId);
  const navigate = useNavigate();
  const toggle = useTogglePlugin();
  const fallback = useUpdateFallback();
  const [uninstallOpen, setUninstallOpen] = useState(false);

  if (!plugin) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6 lg:px-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.admin_plugins_detail_not_found_title()}</EmptyTitle>
            <EmptyDescription>
              {m.admin_plugins_detail_not_found_description({ id: pluginId })}
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => navigate({ to: "/admin/plugins" })}>
            {m.admin_plugins_detail_back()}
          </Button>
        </Empty>
      </div>
    );
  }

  const hasConfig = Boolean(plugin.manifest.globalConfigSchema);
  const hasShared = Boolean(plugin.manifest.sharedCredentialsSchema);

  return (
    <div className="flex flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PluginDetailHeader
        plugin={plugin}
        onToggle={(next) => toggle.mutate({ pluginId: plugin.id, enabled: next })}
        toggling={toggle.isPending}
        onUninstall={() => setUninstallOpen(true)}
      />

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as PluginDetailTab)}>
        <TabsList>
          <TabsTrigger value="overview">{m.admin_plugins_detail_tab_overview()}</TabsTrigger>
          <TabsTrigger value="configuration" disabled={!hasConfig}>
            {m.admin_plugins_detail_tab_configuration()}
          </TabsTrigger>
          <TabsTrigger value="security">{m.admin_plugins_detail_tab_security()}</TabsTrigger>
          <TabsTrigger value="shared" disabled={!hasShared}>
            {m.admin_plugins_detail_tab_shared()}
            {hasShared ? (
              <span className="ml-1.5 rounded-sm border border-border px-1 font-mono text-[10.5px] text-muted-foreground">
                {plugin.sharedCredentialsCount}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5">
          <OverviewTab
            plugin={plugin}
            onChangeFallback={(policy) => fallback.mutate({ pluginId: plugin.id, policy })}
            fallbackPending={fallback.isPending}
          />
        </TabsContent>
        <TabsContent value="configuration" className="mt-5">
          {hasConfig ? <ConfigurationTab plugin={plugin} /> : null}
        </TabsContent>
        <TabsContent value="security" className="mt-5">
          <SecurityTab plugin={plugin} />
        </TabsContent>
        <TabsContent value="shared" className="mt-5">
          {hasShared ? <SharedCredentialsTab plugin={plugin} /> : null}
        </TabsContent>
      </Tabs>

      <UninstallDialog plugin={plugin} open={uninstallOpen} onOpenChange={setUninstallOpen} />
    </div>
  );
}
