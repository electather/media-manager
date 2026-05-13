// fallow-ignore-file complexity
import { Suspense, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cva } from "class-variance-authority";
import { keyBy } from "es-toolkit/array";
import {
  CheckIcon,
  EditIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  StarIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/shared/ui/badge";
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
import { Skeleton } from "@/shared/ui/skeleton";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { relativeTime } from "@/shared/lib/time-format";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/shared/components/settings-page-header";
import { SettingsCard, SettingsCardHeader } from "@/features/settings";
import { NameGlyph } from "@/shared/components/name-glyph";
import { ConnectionModal } from "@/features/connections";
import type { PluginSummary as ModalPluginSummary } from "@/features/connections";
import type { ConnectionListItem, PluginSummary } from "@ent-mcp/shared/connections";
import { type ConnectionStatus } from "@ent-mcp/shared/connections";
import { isNotificationOnlyPlugin } from "@ent-mcp/shared/plugins";
import { settingsConnectionsKeys } from "../lib/query-keys";
import { useAvailablePlugins } from "../hooks/use-available-plugins";
import { useConnections } from "../hooks/use-connections";
import { useDeleteConnection } from "../hooks/use-delete-connection";
import { useSetDefaultConnection } from "../hooks/use-set-default-connection";
import { useTestConnection } from "../hooks/use-test-connection";
import { useToggleEnabled } from "../hooks/use-toggle-enabled";

const STATUS_LABEL: Record<ConnectionStatus, () => string> = {
  connected: () => m.settings_connections_status_connected(),
  expired: () => m.settings_connections_status_expired(),
  error: () => m.settings_connections_status_error(),
  disconnected: () => m.settings_connections_status_disconnected(),
};

const statusBadgeVariants = cva(
  "gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] tracking-wide",
  {
    variants: {
      status: {
        connected: "border border-success/40 bg-success/10 text-success",
        expired: "border border-amber-400/40 bg-amber-400/10 text-amber-500 dark:text-amber-400",
        error: "border border-destructive/40 bg-destructive/10 text-destructive",
        disconnected: "border border-border bg-muted text-muted-foreground",
      } satisfies Record<ConnectionStatus, string>,
    },
  },
);

const statusDotVariants = cva("size-1.5 rounded-full", {
  variants: {
    status: {
      connected: "bg-success",
      expired: "bg-amber-500",
      error: "bg-destructive",
      disconnected: "bg-muted-foreground/60",
    } satisfies Record<ConnectionStatus, string>,
  },
});

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <Badge variant="outline" className={statusBadgeVariants({ status })}>
      <span aria-hidden="true" className={statusDotVariants({ status })} />
      {STATUS_LABEL[status]()}
    </Badge>
  );
}

export function SettingsConnectionsRoute() {
  return (
    <SettingsErrorBoundary>
      <Suspense fallback={<ConnectionsSkeleton />}>
        <ConnectionsPage />
      </Suspense>
    </SettingsErrorBoundary>
  );
}

function ConnectionsSkeleton() {
  return (
    <div className="flex flex-col gap-7">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-72 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}

type Filter = "all" | "issues" | "disabled";

interface ModalTarget {
  plugin: ModalPluginSummary;
  existing?: { id: string; displayName: string | null } | null;
}

function ConnectionsPage() {
  const allConns = useConnections().data;
  const plugins = useAvailablePlugins().data;
  const qc = useQueryClient();

  // Notification-only channels (Telegram, Discord, ntfy) live on the
  // Notifications settings page. Filter them out of the Connections list so
  // the two sections own disjoint plugin sets — the `listAvailablePlugins`
  // server query already excludes them from the catalog grid below.
  const conns = useMemo(
    () =>
      allConns.filter(
        (c) => !isNotificationOnlyPlugin(c.plugin.userScopedCapabilities.map((cap) => cap.id)),
      ),
    [allConns],
  );

  const test = useTestConnection();
  const toggle = useToggleEnabled();
  const setDefault = useSetDefaultConnection();
  const delConn = useDeleteConnection();

  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<ModalTarget | null>(null);
  const [disconnectFor, setDisconnectFor] = useState<ConnectionListItem | null>(null);

  const sorted = useMemo(() => {
    const order: Record<ConnectionStatus, number> = {
      error: 0,
      expired: 1,
      connected: 2,
      disconnected: 3,
    };
    return conns.toSorted((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return order[a.status] - order[b.status];
    });
  }, [conns]);

  const filtered = useMemo(() => {
    if (filter === "issues")
      return sorted.filter((c) => c.status === "error" || c.status === "expired");
    if (filter === "disabled") return sorted.filter((c) => !c.enabled);
    return sorted;
  }, [sorted, filter]);

  const issueCount = conns.filter((c) => c.status === "error" || c.status === "expired").length;
  const disabledCount = conns.filter((c) => !c.enabled).length;

  const onTest = (conn: ConnectionListItem) => {
    toast.message(m.settings_connections_toast_testing());
    test.mutate(conn.id, {
      onSuccess: () =>
        toast.success(
          m.settings_connections_toast_test_ok({ name: conn.plugin.name ?? conn.plugin.id }),
        ),
      onError: (err) => toast.error(err.message),
    });
  };

  const onToggleEnabled = (conn: ConnectionListItem) => {
    toggle.mutate(
      { id: conn.id, enabled: !conn.enabled },
      {
        onSuccess: () =>
          toast.success(
            conn.enabled
              ? m.settings_connections_toast_disabled()
              : m.settings_connections_toast_enabled(),
          ),
      },
    );
  };

  const onSetDefault = (conn: ConnectionListItem) => {
    setDefault.mutate(conn.id, {
      onSuccess: () => toast.success(m.settings_connections_toast_default_updated()),
    });
  };

  const onAdd = (plugin: PluginSummary) => setModal({ plugin: plugin as ModalPluginSummary });

  const pluginsById = useMemo(() => keyBy(plugins, (plugin) => plugin.id), [plugins]);

  const onEdit = (conn: ConnectionListItem) => {
    const plugin = pluginsById[conn.pluginId] ?? null;
    if (!plugin) return;
    setModal({
      plugin: plugin as ModalPluginSummary,
      existing: { id: conn.id, displayName: conn.displayName },
    });
  };

  const onConfirmDisconnect = () => {
    if (!disconnectFor) return;
    const conn = disconnectFor;
    delConn.mutate(conn.id, {
      onSuccess: () => toast.success(m.settings_connections_toast_disconnected()),
      onError: (err) => toast.error(err.message),
    });
    setDisconnectFor(null);
  };

  const disconnectPlugin = disconnectFor ? (pluginsById[disconnectFor.pluginId] ?? null) : null;

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_connections_title()}
        description={m.settings_connections_description()}
      />
      <ConnectionsListCard
        conns={conns}
        plugins={plugins}
        filtered={filtered}
        issueCount={issueCount}
        disabledCount={disabledCount}
        filter={filter}
        setFilter={setFilter}
        onTest={onTest}
        onSetDefault={onSetDefault}
        onToggleEnabled={onToggleEnabled}
        onEdit={onEdit}
        onDisconnect={setDisconnectFor}
      />
      <CatalogCard plugins={plugins} connections={conns} onAdd={onAdd} />
      <DisconnectDialog
        conn={disconnectFor}
        plugin={disconnectPlugin}
        onClose={() => setDisconnectFor(null)}
        onConfirm={onConfirmDisconnect}
      />
      <ConnectionModal
        open={!!modal}
        plugin={modal?.plugin ?? null}
        existing={modal?.existing ?? null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
        onSuccess={() => {
          void qc.invalidateQueries({ queryKey: settingsConnectionsKeys.connections() });
        }}
      />
    </div>
  );
}

function ConnectionsListCard({
  conns,
  plugins,
  filtered,
  issueCount,
  disabledCount,
  filter,
  setFilter,
  onTest,
  onSetDefault,
  onToggleEnabled,
  onEdit,
  onDisconnect,
}: {
  conns: ReadonlyArray<ConnectionListItem>;
  plugins: ReadonlyArray<PluginSummary>;
  filtered: ReadonlyArray<ConnectionListItem>;
  issueCount: number;
  disabledCount: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  onTest: (conn: ConnectionListItem) => void;
  onSetDefault: (conn: ConnectionListItem) => void;
  onToggleEnabled: (conn: ConnectionListItem) => void;
  onEdit: (conn: ConnectionListItem) => void;
  onDisconnect: (conn: ConnectionListItem) => void;
}) {
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_connections_connected_title()}
        count={conns.length}
        description={
          issueCount > 0
            ? issueCount === 1
              ? m.settings_connections_attention_singular({ count: issueCount })
              : m.settings_connections_attention_plural({ count: issueCount })
            : undefined
        }
        action={
          conns.length > 0 ? (
            <ConnectionFilters
              filter={filter}
              setFilter={setFilter}
              total={conns.length}
              issueCount={issueCount}
              disabledCount={disabledCount}
            />
          ) : undefined
        }
      />
      {conns.length === 0 ? (
        <ConnectionsEmpty />
      ) : filtered.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {m.settings_connections_filter_empty()}
        </p>
      ) : (
        <ul role="list" className="flex flex-col">
          {filtered.map((conn, i) => {
            const plugin = plugins.find((p) => p.id === conn.pluginId) ?? conn.plugin;
            const siblings = conns.filter((c) => c.pluginId === plugin.id);
            return (
              <ConnectionRow
                key={conn.id}
                conn={conn}
                plugin={plugin}
                hasSiblings={siblings.length > 1}
                isFirst={i === 0}
                onTest={() => onTest(conn)}
                onSetDefault={() => onSetDefault(conn)}
                onToggleEnabled={() => onToggleEnabled(conn)}
                onEdit={() => onEdit(conn)}
                onDisconnect={() => onDisconnect(conn)}
              />
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}

function ConnectionFilters({
  filter,
  setFilter,
  total,
  issueCount,
  disabledCount,
}: {
  filter: Filter;
  setFilter: (next: Filter) => void;
  total: number;
  issueCount: number;
  disabledCount: number;
}) {
  const filters: ReadonlyArray<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: m.settings_connections_filter_all(), count: total },
    { id: "issues", label: m.settings_connections_filter_issues(), count: issueCount },
    { id: "disabled", label: m.settings_connections_filter_disabled(), count: disabledCount },
  ];
  return (
    <div className="flex gap-1.5" role="tablist" aria-label={m.settings_connections_filter_aria()}>
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={filter === f.id}
          onClick={() => setFilter(f.id)}
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

function ConnectionsEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <PlugIcon className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {m.settings_connections_empty_title()}
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {m.settings_connections_empty_description()}
        </p>
      </div>
    </div>
  );
}

function ConnectionRowMeta({
  conn,
  plugin,
  hasSiblings,
}: {
  conn: ConnectionListItem;
  plugin: PluginSummary;
  hasSiblings: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {plugin.name}
          {plugin.poolable ? (
            <>
              {" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span className="text-muted-foreground">{conn.displayName ?? plugin.name}</span>
            </>
          ) : null}
        </span>
        <ConnectionStatusBadge status={conn.status} />
        {conn.isDefault && hasSiblings ? (
          <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wide">
            <StarIcon className="size-2.5" aria-hidden="true" />
            {m.settings_connections_default_badge()}
          </Badge>
        ) : null}
        {!conn.enabled ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide">
            {m.settings_connections_disabled_badge()}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0 text-xs text-muted-foreground">
        {conn.displayFields.length > 0 ? (
          <span className={conn.displayFields[0]?.mono ? "font-mono" : ""}>
            {conn.displayFields[0]?.value}
          </span>
        ) : null}
        {conn.lastVerifiedAt ? (
          <span>
            {m.settings_connections_last_verified({
              time: relativeTime(new Date(conn.lastVerifiedAt)),
            })}
          </span>
        ) : null}
        {conn.tokenExpiresAt && conn.status !== "expired" ? (
          <span>
            {m.settings_connections_token_expires({
              time: relativeTime(new Date(conn.tokenExpiresAt)),
            })}
          </span>
        ) : null}
      </p>
      {conn.status === "error" && conn.errorMessage ? (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs leading-relaxed text-destructive/90">
          {conn.errorMessage}
        </div>
      ) : null}
      {conn.status === "expired" && conn.tokenExpiresAt ? (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {m.settings_connections_token_expired({
            time: relativeTime(new Date(conn.tokenExpiresAt)),
          })}
        </p>
      ) : null}
    </div>
  );
}

function ConnectionRowActions({
  broken,
  conn,
  plugin,
  hasSiblings,
  onTest,
  onSetDefault,
  onToggleEnabled,
  onEdit,
  onDisconnect,
}: {
  broken: boolean;
  conn: ConnectionListItem;
  plugin: PluginSummary;
  hasSiblings: boolean;
  onTest: () => void;
  onSetDefault: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {broken ? (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <RefreshCwIcon className="size-3.5" aria-hidden="true" />
          {m.settings_connections_action_reconnect()}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.settings_connections_action_more_named({ name: plugin.name })}
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onClick={onTest}>
            <RefreshCwIcon className="size-3.5" />
            {m.settings_connections_action_test()}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEdit}>
            <EditIcon className="size-3.5" />
            {m.settings_connections_action_edit()}
          </DropdownMenuItem>
          {plugin.poolable && hasSiblings && !conn.isDefault ? (
            <DropdownMenuItem onClick={onSetDefault}>
              <StarIcon className="size-3.5" />
              {m.settings_connections_action_set_default()}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onToggleEnabled}>
            {conn.enabled ? <XIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
            {conn.enabled
              ? m.settings_connections_action_disable()
              : m.settings_connections_action_enable()}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDisconnect} variant="destructive">
            <LogOutIcon className="size-3.5" />
            {m.settings_connections_action_disconnect()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ConnectionRow({
  conn,
  plugin,
  hasSiblings,
  isFirst,
  onTest,
  onSetDefault,
  onToggleEnabled,
  onEdit,
  onDisconnect,
}: {
  conn: ConnectionListItem;
  plugin: PluginSummary;
  hasSiblings: boolean;
  isFirst: boolean;
  onTest: () => void;
  onSetDefault: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  const broken = conn.status === "error" || conn.status === "expired";

  return (
    <li
      className={cn(
        "relative flex flex-wrap items-start gap-3 px-5 py-4 sm:flex-nowrap sm:items-center sm:gap-4 sm:px-6",
        !isFirst && "border-t border-border",
        !conn.enabled && "opacity-60",
      )}
    >
      {broken ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 left-0 w-0.5",
            conn.status === "error" ? "bg-destructive" : "bg-amber-400",
          )}
        />
      ) : null}
      <NameGlyph name={plugin.name} />
      <ConnectionRowMeta conn={conn} plugin={plugin} hasSiblings={hasSiblings} />
      <ConnectionRowActions
        broken={broken}
        conn={conn}
        plugin={plugin}
        hasSiblings={hasSiblings}
        onTest={onTest}
        onSetDefault={onSetDefault}
        onToggleEnabled={onToggleEnabled}
        onEdit={onEdit}
        onDisconnect={onDisconnect}
      />
    </li>
  );
}

function CatalogCard({
  plugins,
  connections,
  onAdd,
}: {
  plugins: ReadonlyArray<PluginSummary>;
  connections: ReadonlyArray<ConnectionListItem>;
  onAdd: (plugin: PluginSummary) => void;
}) {
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_connections_catalog_title()}
        description={m.settings_connections_catalog_description()}
      />
      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
        {plugins.map((plugin) => {
          const hasInstance = connections.some((c) => c.pluginId === plugin.id);
          const canAdd = !hasInstance || plugin.poolable;
          const cta = !canAdd
            ? m.settings_connections_catalog_connected()
            : plugin.poolable && hasInstance
              ? m.settings_connections_catalog_add_another()
              : m.settings_connections_catalog_connect();
          return (
            <div
              key={plugin.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-input"
            >
              <div className="flex items-center gap-3">
                <NameGlyph name={plugin.name} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{plugin.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    {plugin.poolable ? "Multi" : "Single"}
                  </p>
                </div>
              </div>
              <p className="line-clamp-2 min-h-9 text-xs text-muted-foreground">
                {plugin.description}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={!canAdd}
                onClick={() => canAdd && onAdd(plugin)}
                className="w-full"
              >
                {canAdd ? <PlusIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
                {cta}
              </Button>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}

function DisconnectDialog({
  conn,
  plugin,
  onClose,
  onConfirm,
}: {
  conn: ConnectionListItem | null;
  plugin: PluginSummary | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={!!conn}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <TriangleAlertIcon className="size-4" aria-hidden="true" />
            </div>
            <DialogTitle>
              {m.settings_connections_disconnect_dialog_title({ name: plugin?.name ?? "" })}
            </DialogTitle>
          </div>
          <DialogDescription>{m.settings_connections_disconnect_dialog_body()}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_connections_drawer_close()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-disconnect">
            {m.settings_connections_action_disconnect()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
