// fallow-ignore-file complexity
import { Suspense, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { InfoIcon, LayersIcon, MoreHorizontalIcon, PlugIcon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
import { CopyButton } from "@/shared/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Skeleton } from "@/shared/ui/skeleton";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import {
  AuthorizedAppRow,
  MetaSep,
  ScopeChip,
  SettingsCard,
  SettingsCardHeader,
  SetupGuideModal,
  revokeAuthorizedApp,
  settingsKeys,
  useAuthorizedApps,
  usePublicConfig,
  useRevokeAuthorizedApp,
} from "@/features/settings";
import type { AuthorizedApp, AuthorizedAppStatus } from "@ent-mcp/shared/users";

export const Route = createFileRoute("/_authenticated/_settings/settings/apps")({
  component: AppsRoute,
});

function AppsRoute() {
  return (
    <SettingsErrorBoundary>
      <Suspense fallback={<AppsSkeleton />}>
        <AppsPage />
      </Suspense>
    </SettingsErrorBoundary>
  );
}

function AppsSkeleton() {
  return (
    <div className="flex flex-col gap-7">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

type Filter = "all" | "active" | "idle" | "new";

const STATUS_ORDER: Record<AuthorizedAppStatus, number> = { active: 0, new: 1, idle: 2 };

function AppsPage() {
  const apps = useAuthorizedApps().data;
  const publicConfig = usePublicConfig().data;
  const revoke = useRevokeAuthorizedApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmRevoke, setConfirmRevoke] = useState<AuthorizedApp | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);

  const onRevoke = () => {
    if (!confirmRevoke) return;
    const target = confirmRevoke;
    setConfirmRevoke(null);
    revoke.mutate(target.clientId, {
      onSuccess: () => toast.success(m.settings_apps_toast_revoked({ name: target.name })),
      onError: (err) => toast.error(err.message),
    });
  };

  const qc = useQueryClient();
  // Bulk revoke. There is no server-side bulk endpoint — call sequentially via
  // the raw fetcher so each request does not run the single-revoke hook's
  // optimistic update + rollback chain. That chain snapshots the cache after
  // every prior optimistic delete, so a mid-loop failure would roll back to a
  // half-mutated snapshot and either show ghost rows or hide already-revoked
  // ones. Here we leave the cache untouched until the loop settles, then
  // invalidate to refetch the server's authoritative list.
  const onRevokeAll = async () => {
    setConfirmRevokeAll(false);
    const count = apps.length;
    const targets = apps.map((a) => a.clientId);
    let failed = 0;
    for (const clientId of targets) {
      try {
        await revokeAuthorizedApp(clientId);
      } catch {
        failed += 1;
      }
    }
    await qc.invalidateQueries({ queryKey: settingsKeys.apps() });
    if (failed > 0) {
      toast.error(m.settings_apps_toast_revoke_all_failed());
      return;
    }
    toast.success(m.settings_apps_toast_revoked_all({ count }));
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
        onConfirm={onRevoke}
      />
      <RevokeAllDialog
        open={confirmRevokeAll}
        count={apps.length}
        onCancel={() => setConfirmRevokeAll(false)}
        onConfirm={() => void onRevokeAll()}
      />
    </div>
  );
}

// ─── Authorized clients card ────────────────────────────────────────────────

function useAuthorizedAppsView(apps: ReadonlyArray<AuthorizedApp>, filter: Filter) {
  const counts = useMemo(
    () => ({
      all: apps.length,
      active: apps.filter((a) => a.status === "active").length,
      idle: apps.filter((a) => a.status === "idle").length,
      new: apps.filter((a) => a.status === "new").length,
    }),
    [apps],
  );

  const visible = useMemo(() => {
    const matches = filter === "all" ? apps : apps.filter((a) => a.status === filter);
    return matches.toSorted((a, b) => {
      const oa = STATUS_ORDER[a.status];
      const ob = STATUS_ORDER[b.status];
      if (oa !== ob) return oa - ob;
      return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    });
  }, [apps, filter]);

  return { counts, visible };
}

function AuthorizedAppsCard({
  apps,
  filter,
  setFilter,
  onRequestRevoke,
  onRequestRevokeAll,
}: {
  apps: ReadonlyArray<AuthorizedApp>;
  filter: Filter;
  setFilter: (next: Filter) => void;
  onRequestRevoke: (app: AuthorizedApp) => void;
  onRequestRevokeAll: () => void;
}) {
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
      <AuthorizedAppsBody empty={apps.length === 0} visible={visible} onRevoke={onRequestRevoke} />
    </SettingsCard>
  );
}

function AuthorizedAppsBody({
  empty,
  visible,
  onRevoke,
}: {
  empty: boolean;
  visible: ReadonlyArray<AuthorizedApp>;
  onRevoke: (app: AuthorizedApp) => void;
}) {
  if (empty) return <AppsEmpty />;
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

// ─── MCP endpoint card ──────────────────────────────────────────────────────

function McpEndpointCard({
  endpointUrl,
  scopes,
  clientCount,
  onShowSetupGuide,
}: {
  endpointUrl: string;
  scopes: ReadonlyArray<string>;
  clientCount: number;
  onShowSetupGuide: () => void;
}) {
  return (
    <SettingsCard>
      <McpEndpointHeader onShowSetupGuide={onShowSetupGuide} />
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        <McpEndpointUrl url={endpointUrl} />
        <McpEndpointMeta clientCount={clientCount} />
        <McpEndpointScopeSummary scopes={scopes} />
      </div>
    </SettingsCard>
  );
}

function McpEndpointHeader({ onShowSetupGuide }: { onShowSetupGuide: () => void }) {
  return (
    <div className="flex items-start gap-4 border-b border-border px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">
          {m.settings_apps_endpoint_label()}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {m.settings_apps_endpoint_description()}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.settings_apps_endpoint_action_more()}
              data-testid="endpoint-actions"
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onShowSetupGuide} data-testid="open-setup-guide">
            <InfoIcon className="size-3.5" />
            {m.settings_apps_endpoint_setup_guide()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function McpEndpointUrl({ url }: { url: string }) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center border-e border-border px-3.5 text-muted-foreground">
        <PlugIcon className="size-3.5" aria-hidden="true" />
      </div>
      <div
        className="min-w-0 flex-1 truncate px-3.5 py-3 font-mono text-[13px] text-foreground"
        title={url}
      >
        {url}
      </div>
      <CopyButton
        value={url}
        label={m.settings_apps_endpoint_copy_short()}
        copiedLabel={m.settings_apps_endpoint_copied()}
        aria-label={m.settings_apps_endpoint_copy()}
        title={m.settings_apps_endpoint_copy()}
        data-testid="copy-endpoint"
        className="h-auto shrink-0 gap-1.5 rounded-none border-0 border-s border-border bg-muted px-3.5 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
        iconClassName="size-3.5"
      />
    </div>
  );
}

function McpEndpointMeta({ clientCount }: { clientCount: number }) {
  const clientLabel =
    clientCount === 1
      ? m.settings_apps_endpoint_clients_singular({ count: clientCount })
      : m.settings_apps_endpoint_clients_plural({ count: clientCount });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
        {m.settings_apps_endpoint_status_live()}
      </span>
      <MetaSep />
      <span>{clientLabel}</span>
    </div>
  );
}

function McpEndpointScopeSummary({ scopes }: { scopes: ReadonlyArray<string> }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-3.5 py-3">
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"
      >
        <ShieldCheckIcon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {m.settings_apps_endpoint_scope_summary()}
        </p>
        <div className="flex flex-wrap gap-1">
          {scopes.map((scope) => (
            <ScopeChip key={scope} scope={scope} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Filter pills ───────────────────────────────────────────────────────────

function ClientFilters({
  filter,
  setFilter,
  counts,
}: {
  filter: Filter;
  setFilter: (next: Filter) => void;
  counts: { all: number; active: number; idle: number; new: number };
}) {
  const filters: ReadonlyArray<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: m.settings_apps_filter_all(), count: counts.all },
    { id: "active", label: m.settings_apps_filter_active(), count: counts.active },
    { id: "new", label: m.settings_apps_filter_new(), count: counts.new },
    { id: "idle", label: m.settings_apps_filter_idle(), count: counts.idle },
  ];
  return (
    <div className="flex gap-1.5" role="tablist" aria-label={m.settings_apps_filter_aria()}>
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={filter === f.id}
          onClick={() => setFilter(f.id)}
          data-testid={`filter-${f.id}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            filter === f.id
              ? "border-input bg-muted text-foreground"
              : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          {f.label}
          <span className="font-mono text-[10px] text-muted-foreground/80">{f.count}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function AppsEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <LayersIcon className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{m.settings_apps_empty_title()}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {m.settings_apps_empty_description()}
        </p>
      </div>
    </div>
  );
}

// ─── Dialogs ────────────────────────────────────────────────────────────────

function RevokeOneDialog({
  app,
  onCancel,
  onConfirm,
}: {
  app: AuthorizedApp | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={!!app}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {app ? m.settings_apps_revoke_dialog_title({ name: app.name }) : ""}
          </DialogTitle>
          <DialogDescription>{m.settings_apps_revoke_dialog_body()}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {m.settings_apps_revoke_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke-app">
            {m.settings_apps_revoke_dialog_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeAllDialog({
  open,
  count,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title =
    count === 1
      ? m.settings_apps_revoke_all_dialog_title_singular({ count })
      : m.settings_apps_revoke_all_dialog_title_plural({ count });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{m.settings_apps_revoke_all_dialog_body()}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {m.settings_apps_revoke_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke-all">
            {m.settings_apps_revoke_all_dialog_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
