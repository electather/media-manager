import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckIcon,
  CopyIcon,
  InfoIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PlugIcon,
  RotateCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/shared/ui/button";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { useCopyFeedback } from "@/shared/hooks/use-copy-feedback";
import { relativeTime } from "@/shared/lib/relative-time";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import {
  AuthorizedAppRow,
  ScopeChip,
  SettingsCard,
  SettingsCardHeader,
  SetupGuideModal,
} from "@/features/settings";
import {
  MCP_ENDPOINT_SCOPES,
  MOCK_AUTHORIZED_APPS,
  MOCK_MCP_ENDPOINT,
  type MockAuthorizedApp,
  type MockAuthorizedAppStatus,
  type MockMcpEndpoint,
} from "@/features/settings/mocks";

export const Route = createFileRoute("/_authenticated/_settings/settings/apps")({
  component: AppsRoute,
});

function AppsRoute() {
  return (
    <SettingsErrorBoundary>
      <AppsPage />
    </SettingsErrorBoundary>
  );
}

type Filter = "all" | "active" | "idle";

const STATUS_ORDER: Record<MockAuthorizedAppStatus, number> = { active: 0, new: 1, idle: 2 };

interface AppsState {
  endpoint: MockMcpEndpoint;
  apps: ReadonlyArray<MockAuthorizedApp>;
}

function useAppsState() {
  const [state, setState] = useState<AppsState>({
    endpoint: MOCK_MCP_ENDPOINT,
    apps: MOCK_AUTHORIZED_APPS,
  });

  const revokeOne = (id: string, name: string) => {
    setState((s) => ({ ...s, apps: s.apps.filter((a) => a.clientId !== id) }));
    toast.success(m.settings_apps_toast_revoked({ name }));
  };

  const revokeAll = () => {
    setState((s) => {
      toast.success(m.settings_apps_toast_revoked_all({ count: s.apps.length }));
      return { ...s, apps: [] };
    });
  };

  const rotate = () => {
    setState((s) => ({
      endpoint: {
        url: s.endpoint.url.replace(/t=[^&]+/, `t=${randomToken()}`),
        rotatedAt: new Date().toISOString(),
      },
      apps: [],
    }));
    toast.success(m.settings_apps_toast_rotated());
  };

  const rename = (id: string, next: string) => {
    setState((s) => ({
      ...s,
      apps: s.apps.map((a) => (a.clientId === id ? { ...a, name: next } : a)),
    }));
    toast.success(m.settings_apps_toast_renamed());
  };

  return { state, revokeOne, revokeAll, rotate, rename };
}

function AppsPage() {
  const { state, revokeOne, revokeAll, rotate, rename } = useAppsState();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmRevoke, setConfirmRevoke] = useState<MockAuthorizedApp | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [renameFor, setRenameFor] = useState<MockAuthorizedApp | null>(null);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_apps_title()}
        description={m.settings_apps_description()}
      />
      <McpEndpointCard
        endpoint={state.endpoint}
        clientCount={state.apps.length}
        onRotate={() => setConfirmRotate(true)}
        onShowSetupGuide={() => setSetupGuideOpen(true)}
      />
      <SetupGuideModal
        endpoint={state.endpoint.url}
        open={setupGuideOpen}
        onClose={() => setSetupGuideOpen(false)}
      />
      <AuthorizedAppsCard
        apps={state.apps}
        filter={filter}
        setFilter={setFilter}
        onRequestRevoke={setConfirmRevoke}
        onRequestRename={setRenameFor}
        onRequestRevokeAll={() => setConfirmRevokeAll(true)}
      />
      <AppsDialogs
        confirmRevoke={confirmRevoke}
        confirmRevokeAll={confirmRevokeAll}
        confirmRotate={confirmRotate}
        renameFor={renameFor}
        totalApps={state.apps.length}
        onCloseRevoke={() => setConfirmRevoke(null)}
        onCloseRevokeAll={() => setConfirmRevokeAll(false)}
        onCloseRotate={() => setConfirmRotate(false)}
        onCloseRename={() => setRenameFor(null)}
        onRevoke={() => {
          if (confirmRevoke) {
            revokeOne(confirmRevoke.clientId, confirmRevoke.name);
            setConfirmRevoke(null);
          }
        }}
        onRevokeAll={() => {
          revokeAll();
          setConfirmRevokeAll(false);
        }}
        onRotate={() => {
          rotate();
          setConfirmRotate(false);
        }}
        onRename={(name) => {
          if (renameFor) {
            rename(renameFor.clientId, name);
            setRenameFor(null);
          }
        }}
      />
    </div>
  );
}

// ─── Authorized clients card ────────────────────────────────────────────────

function AuthorizedAppsCard({
  apps,
  filter,
  setFilter,
  onRequestRevoke,
  onRequestRename,
  onRequestRevokeAll,
}: {
  apps: ReadonlyArray<MockAuthorizedApp>;
  filter: Filter;
  setFilter: (next: Filter) => void;
  onRequestRevoke: (app: MockAuthorizedApp) => void;
  onRequestRename: (app: MockAuthorizedApp) => void;
  onRequestRevokeAll: () => void;
}) {
  const counts = useMemo(
    () => ({
      all: apps.length,
      active: apps.filter((a) => a.status === "active").length,
      idle: apps.filter((a) => a.status === "idle").length,
    }),
    [apps],
  );

  const visible = useMemo(() => {
    const matches = filter === "all" ? apps : apps.filter((a) => a.status === filter);
    return [...matches].sort((a, b) => {
      const oa = STATUS_ORDER[a.status] ?? 99;
      const ob = STATUS_ORDER[b.status] ?? 99;
      if (oa !== ob) return oa - ob;
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }, [apps, filter]);

  const onActivity = (app: MockAuthorizedApp) =>
    toast.message(m.settings_apps_toast_activity_log({ name: app.name }));

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
      <AuthorizedAppsBody
        empty={apps.length === 0}
        visible={visible}
        onRevoke={onRequestRevoke}
        onRename={onRequestRename}
        onViewActivity={onActivity}
      />
    </SettingsCard>
  );
}

function AuthorizedAppsBody({
  empty,
  visible,
  onRevoke,
  onRename,
  onViewActivity,
}: {
  empty: boolean;
  visible: ReadonlyArray<MockAuthorizedApp>;
  onRevoke: (app: MockAuthorizedApp) => void;
  onRename: (app: MockAuthorizedApp) => void;
  onViewActivity: (app: MockAuthorizedApp) => void;
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
        <AuthorizedAppRow
          key={app.clientId}
          app={app}
          isFirst={i === 0}
          onRevoke={onRevoke}
          onRename={onRename}
          onViewActivity={onViewActivity}
        />
      ))}
    </ul>
  );
}

// ─── MCP endpoint card ──────────────────────────────────────────────────────

function McpEndpointCard({
  endpoint,
  clientCount,
  onRotate,
  onShowSetupGuide,
}: {
  endpoint: MockMcpEndpoint;
  clientCount: number;
  onRotate: () => void;
  onShowSetupGuide: () => void;
}) {
  return (
    <SettingsCard>
      <McpEndpointHeader onRotate={onRotate} onShowSetupGuide={onShowSetupGuide} />
      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        <McpEndpointUrl url={endpoint.url} />
        <McpEndpointMeta clientCount={clientCount} rotatedAt={endpoint.rotatedAt} />
        <McpEndpointScopeSummary />
      </div>
    </SettingsCard>
  );
}

function McpEndpointHeader({
  onRotate,
  onShowSetupGuide,
}: {
  onRotate: () => void;
  onShowSetupGuide: () => void;
}) {
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
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onRotate} data-testid="rotate-endpoint">
            <RotateCwIcon className="size-3.5" />
            {m.settings_apps_endpoint_action_rotate()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function McpEndpointUrl({ url }: { url: string }) {
  const { copied, copy } = useCopyFeedback();
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
      <button
        type="button"
        onClick={() => void copy(url)}
        aria-label={m.settings_apps_endpoint_copy()}
        data-testid="copy-endpoint"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 border-s border-border px-3.5 text-xs font-medium transition-colors",
          copied
            ? "bg-success/15 text-success"
            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
        )}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function McpEndpointMeta({ clientCount, rotatedAt }: { clientCount: number; rotatedAt: string }) {
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
      <Sep />
      <span>{clientLabel}</span>
      <Sep />
      <span>{m.settings_apps_endpoint_rotated({ time: relativeTime(new Date(rotatedAt)) })}</span>
    </div>
  );
}

function McpEndpointScopeSummary() {
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
          {MCP_ENDPOINT_SCOPES.map((scope) => (
            <ScopeChip key={scope} scope={scope} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/60">
      ·
    </span>
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
  counts: { all: number; active: number; idle: number };
}) {
  const filters: ReadonlyArray<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: m.settings_apps_filter_all(), count: counts.all },
    { id: "active", label: m.settings_apps_filter_active(), count: counts.active },
    { id: "idle", label: m.settings_apps_filter_idle(), count: counts.idle },
  ];
  return (
    <div className="flex gap-1.5" role="tablist" aria-label="Filter authorized clients">
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

function AppsDialogs(props: {
  confirmRevoke: MockAuthorizedApp | null;
  confirmRevokeAll: boolean;
  confirmRotate: boolean;
  renameFor: MockAuthorizedApp | null;
  totalApps: number;
  onCloseRevoke: () => void;
  onCloseRevokeAll: () => void;
  onCloseRotate: () => void;
  onCloseRename: () => void;
  onRevoke: () => void;
  onRevokeAll: () => void;
  onRotate: () => void;
  onRename: (name: string) => void;
}) {
  return (
    <>
      <RevokeOneDialog
        app={props.confirmRevoke}
        onCancel={props.onCloseRevoke}
        onConfirm={props.onRevoke}
      />
      <RevokeAllDialog
        open={props.confirmRevokeAll}
        count={props.totalApps}
        onCancel={props.onCloseRevokeAll}
        onConfirm={props.onRevokeAll}
      />
      <RotateDialog
        open={props.confirmRotate}
        onCancel={props.onCloseRotate}
        onConfirm={props.onRotate}
      />
      <RenameDialog
        app={props.renameFor}
        onCancel={props.onCloseRename}
        onConfirm={props.onRename}
      />
    </>
  );
}

function RevokeOneDialog({
  app,
  onCancel,
  onConfirm,
}: {
  app: MockAuthorizedApp | null;
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

function RotateDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_apps_rotate_dialog_title()}</DialogTitle>
          <DialogDescription>{m.settings_apps_rotate_dialog_body()}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {m.settings_apps_rotate_dialog_warning()}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {m.settings_apps_revoke_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-rotate">
            {m.settings_apps_rotate_dialog_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  app,
  onCancel,
  onConfirm,
}: {
  app: MockAuthorizedApp | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (app) setValue(app.name);
  }, [app]);

  const trimmed = value.trim();

  return (
    <Dialog
      open={!!app}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_apps_rename_dialog_title()}</DialogTitle>
          <DialogDescription>{m.settings_apps_rename_dialog_body()}</DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          placeholder={m.settings_apps_rename_dialog_placeholder()}
          data-testid="rename-input"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {m.settings_apps_revoke_dialog_cancel()}
          </Button>
          <Button
            disabled={trimmed.length === 0}
            onClick={() => onConfirm(trimmed)}
            data-testid="confirm-rename"
          >
            {m.settings_apps_rename_dialog_save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function randomToken(): string {
  const part = () => Math.random().toString(36).slice(2, 10);
  const t = `${part()}${part()}${part()}${part().slice(0, 4)}`;
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20, 32)}`;
}
