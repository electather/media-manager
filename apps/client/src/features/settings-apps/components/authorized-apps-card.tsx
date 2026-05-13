import { useMemo } from "react";
import type { AuthorizedApp, AuthorizedAppStatus } from "@ent-mcp/shared/users";

import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";
import { SettingsCard, SettingsCardHeader } from "@/features/settings/components/settings-card";

import type { AuthorizedAppsFilter } from "../lib/types";
import { AuthorizedAppRow } from "./authorized-app-row";
import { AppsEmpty } from "./apps-empty";
import { ClientFilters } from "./client-filters";

const STATUS_ORDER: Record<AuthorizedAppStatus, number> = { active: 0, new: 1, idle: 2 };

interface AuthorizedAppsCardProps {
  apps: ReadonlyArray<AuthorizedApp>;
  filter: AuthorizedAppsFilter;
  setFilter: (next: AuthorizedAppsFilter) => void;
  onRequestRevoke: (app: AuthorizedApp) => void;
  onRequestRevokeAll: () => void;
}

interface AuthorizedAppsView {
  counts: Record<AuthorizedAppsFilter, number>;
  visible: ReadonlyArray<AuthorizedApp>;
}

function useAuthorizedAppsView(
  apps: ReadonlyArray<AuthorizedApp>,
  filter: AuthorizedAppsFilter,
): AuthorizedAppsView {
  return useMemo(() => {
    const counts: Record<AuthorizedAppsFilter, number> = {
      all: apps.length,
      active: 0,
      idle: 0,
      new: 0,
    };
    const matched: AuthorizedApp[] = [];

    for (const app of apps) {
      counts[app.status] += 1;
      if (filter === "all" || app.status === filter) {
        matched.push(app);
      }
    }

    matched.sort((a, b) => {
      const statusOrder = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusOrder !== 0) return statusOrder;
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    });

    return { counts, visible: matched };
  }, [apps, filter]);
}

export function AuthorizedAppsCard({
  apps,
  filter,
  setFilter,
  onRequestRevoke,
  onRequestRevokeAll,
}: AuthorizedAppsCardProps) {
  const { counts, visible } = useAuthorizedAppsView(apps, filter);

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_apps_authorized_title()}
        count={apps.length}
        description={apps.length > 0 ? m.settings_apps_authorized_description() : undefined}
        action={
          apps.length > 0 ? (
            <div className="flex items-center gap-2">
              <ClientFilters filter={filter} setFilter={setFilter} counts={counts} />
              <Button
                variant="ghost"
                size="sm"
                onClick={onRequestRevokeAll}
                data-testid="revoke-all"
              >
                {m.settings_apps_revoke_all()}
              </Button>
            </div>
          ) : null
        }
      />
      <AuthorizedAppsBody totalCount={apps.length} visible={visible} onRevoke={onRequestRevoke} />
    </SettingsCard>
  );
}

function AuthorizedAppsBody({
  totalCount,
  visible,
  onRevoke,
}: {
  totalCount: number;
  visible: ReadonlyArray<AuthorizedApp>;
  onRevoke: (app: AuthorizedApp) => void;
}) {
  if (totalCount === 0) return <AppsEmpty />;
  if (visible.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-sm text-muted-foreground">
        {m.settings_apps_filter_empty()}
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col">
      {visible.map((app, i) => (
        <AuthorizedAppRow key={app.clientId} app={app} isFirst={i === 0} onRevoke={onRevoke} />
      ))}
    </ul>
  );
}
