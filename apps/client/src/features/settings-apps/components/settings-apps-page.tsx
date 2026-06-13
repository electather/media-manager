import { Suspense, useState } from "react";
import type { AuthorizedApp } from "@nama/shared/users";
import { toast } from "sonner";

import { SettingsPageHeader } from "@/shared/components/settings-page-header";
import { m } from "@/paraglide/messages";

import { useAuthorizedApps } from "../hooks/use-authorized-apps";
import { usePublicConfig } from "../hooks/use-public-config";
import { useRevokeAllAuthorizedApps } from "../hooks/use-revoke-all-authorized-apps";
import { useRevokeAuthorizedApp } from "../hooks/use-revoke-authorized-app";
import type { AuthorizedAppsFilter } from "../lib/types";
import { AppsSkeleton } from "./apps-skeleton";
import { AuthorizedAppsCard } from "./authorized-apps-card";
import { McpEndpointCard } from "./mcp-endpoint-card";
import { RevokeAllDialog, RevokeOneDialog } from "./revoke-dialogs";
import { SettingsAppsErrorBoundary } from "./settings-apps-error-boundary";
import { SetupGuideModal } from "./setup-guide-modal";

export function SettingsAppsRoute() {
  return (
    <SettingsAppsErrorBoundary>
      <Suspense fallback={<AppsSkeleton />}>
        <SettingsAppsPage />
      </Suspense>
    </SettingsAppsErrorBoundary>
  );
}

function SettingsAppsPage() {
  const apps = useAuthorizedApps().data;
  const publicConfig = usePublicConfig().data;
  const revoke = useRevokeAuthorizedApp();
  const revokeAll = useRevokeAllAuthorizedApps();
  const [filter, setFilter] = useState<AuthorizedAppsFilter>("all");
  const [confirmRevoke, setConfirmRevoke] = useState<AuthorizedApp | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);

  const onConfirmRevoke = () => {
    if (!confirmRevoke) return;
    const target = confirmRevoke;
    setConfirmRevoke(null);
    revoke.mutate(target.clientId, {
      onSuccess: () => toast.success(m.settings_apps_toast_revoked({ name: target.name })),
      onError: (error) => toast.error(error.message),
    });
  };

  const onConfirmRevokeAll = () => {
    const targets = apps;
    setConfirmRevokeAll(false);
    revokeAll.mutate(targets, {
      onSuccess: ({ count, failed }) => {
        if (failed > 0) {
          toast.error(m.settings_apps_toast_revoke_all_failed());
          return;
        }
        toast.success(m.settings_apps_toast_revoked_all({ count }));
      },
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_apps_title()}
        description={m.settings_apps_description()}
      />
      <McpEndpointCard
        endpointUrl={publicConfig.mcpEndpointUrl}
        scopes={publicConfig.mcpScopes}
        clientCount={apps.length}
        onShowSetupGuide={() => setSetupGuideOpen(true)}
      />
      <SetupGuideModal
        endpoint={publicConfig.mcpEndpointUrl}
        open={setupGuideOpen}
        onClose={() => setSetupGuideOpen(false)}
      />
      <AuthorizedAppsCard
        apps={apps}
        filter={filter}
        setFilter={setFilter}
        onRequestRevoke={setConfirmRevoke}
        onRequestRevokeAll={() => setConfirmRevokeAll(true)}
      />
      <RevokeOneDialog
        app={confirmRevoke}
        onCancel={() => setConfirmRevoke(null)}
        onConfirm={onConfirmRevoke}
      />
      <RevokeAllDialog
        open={confirmRevokeAll}
        count={apps.length}
        onCancel={() => setConfirmRevokeAll(false)}
        onConfirm={onConfirmRevokeAll}
      />
    </div>
  );
}
