import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { relativeTime } from "@/shared/lib/relative-time";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import { SettingsCard, SettingsCardHeader } from "@/features/settings";
import { NameGlyph } from "@/shared/components/name-glyph";
import {
  MOCK_CONNECTIONS,
  MOCK_PLUGINS,
  type ConnectionStatus,
  type MockConnection,
  type MockPlugin,
} from "@/features/settings/mocks";

const STATUS_LABEL: Record<ConnectionStatus, () => string> = {
  connected: () => m.settings_connections_status_connected(),
  expired: () => m.settings_connections_status_expired(),
  error: () => m.settings_connections_status_error(),
  disconnected: () => m.settings_connections_status_disconnected(),
};

const STATUS_BADGE_CLASS: Record<ConnectionStatus, string> = {
  connected: "border border-success/40 bg-success/10 text-success",
  expired: "border border-amber-400/40 bg-amber-400/10 text-amber-500 dark:text-amber-400",
  error: "border border-destructive/40 bg-destructive/10 text-destructive",
  disconnected: "border border-border bg-muted text-muted-foreground",
};

const STATUS_DOT_CLASS: Record<ConnectionStatus, string> = {
  connected: "bg-success",
  expired: "bg-amber-500",
  error: "bg-destructive",
  disconnected: "bg-muted-foreground/60",
};

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] tracking-wide",
        STATUS_BADGE_CLASS[status],
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", STATUS_DOT_CLASS[status])} />
      {STATUS_LABEL[status]()}
    </Badge>
  );
}

export const Route = createFileRoute("/_authenticated/_settings/settings/connections")({
  component: ConnectionsRoute,
});

function ConnectionsRoute() {
  return (
    <SettingsErrorBoundary>
      <ConnectionsPage />
    </SettingsErrorBoundary>
  );
}

type Filter = "all" | "issues" | "disabled";

function useConnectionsState() {
  const [conns, setConns] = useState<ReadonlyArray<MockConnection>>(MOCK_CONNECTIONS);
  const [filter, setFilter] = useState<Filter>("all");
  const [disconnectFor, setDisconnectFor] = useState<MockConnection | null>(null);
  const testTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (testTimerRef.current !== null) window.clearTimeout(testTimerRef.current);
    },
    [],
  );

  const sorted = useMemo(() => {
    const order: Record<MockConnection["status"], number> = {
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

  const updateConnection = (
    id: string,
    next: Partial<MockConnection> | ((c: MockConnection) => MockConnection),
  ) => {
    setConns((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        return typeof next === "function" ? next(c) : { ...c, ...next };
      }),
    );
  };

  const handleTest = (conn: MockConnection) => {
    toast.message(m.settings_connections_toast_testing());
    if (testTimerRef.current !== null) window.clearTimeout(testTimerRef.current);
    testTimerRef.current = window.setTimeout(() => {
      testTimerRef.current = null;
      updateConnection(conn.id, { lastVerifiedAt: new Date().toISOString() });
      const plugin = MOCK_PLUGINS.find((p) => p.id === conn.pluginId);
      toast.success(m.settings_connections_toast_test_ok({ name: plugin?.name ?? conn.label }));
    }, 600);
  };

  const handleSetDefault = (conn: MockConnection) => {
    setConns((list) =>
      list.map((c) => (c.pluginId === conn.pluginId ? { ...c, isDefault: c.id === conn.id } : c)),
    );
    toast.success(m.settings_connections_toast_default_updated());
  };

  const handleToggleEnabled = (conn: MockConnection) => {
    updateConnection(conn.id, { enabled: !conn.enabled });
    toast.success(
      conn.enabled
        ? m.settings_connections_toast_disabled()
        : m.settings_connections_toast_enabled(),
    );
  };

  const handleAdd = (plugin: MockPlugin) => {
    const newConn: MockConnection = {
      id: `c-${plugin.id}-${Math.random().toString(36).slice(2, 7)}`,
      pluginId: plugin.id,
      label: plugin.name,
      status: "connected",
      enabled: true,
      isDefault: !conns.some((c) => c.pluginId === plugin.id),
      lastVerifiedAt: new Date().toISOString(),
      tokenExpiresAt: null,
    };
    setConns((list) => [newConn, ...list]);
    toast.success(m.settings_connections_catalog_connect());
  };

  const handleReconnect = (conn: MockConnection) => {
    updateConnection(conn.id, { status: "connected", enabled: true, errorMessage: undefined });
  };

  const cancelDisconnect = () => setDisconnectFor(null);

  const confirmDisconnect = () => {
    if (!disconnectFor) return;
    setConns((list) => list.filter((c) => c.id !== disconnectFor.id));
    setDisconnectFor(null);
    toast.success(m.settings_connections_toast_disconnected());
  };

  return {
    conns,
    filter,
    setFilter,
    filtered,
    issueCount,
    disabledCount,
    disconnectFor,
    setDisconnectFor,
    handleTest,
    handleSetDefault,
    handleToggleEnabled,
    handleAdd,
    handleReconnect,
    cancelDisconnect,
    confirmDisconnect,
  };
}

function ConnectionsPage() {
  const {
    conns,
    filter,
    setFilter,
    filtered,
    issueCount,
    disabledCount,
    disconnectFor,
    setDisconnectFor,
    handleTest,
    handleSetDefault,
    handleToggleEnabled,
    handleAdd,
    handleReconnect,
    cancelDisconnect,
    confirmDisconnect,
  } = useConnectionsState();

  const disconnectPlugin = disconnectFor
    ? (MOCK_PLUGINS.find((p) => p.id === disconnectFor.pluginId) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_connections_title()}
        description={m.settings_connections_description()}
      />
      <ConnectionsListCard
        conns={conns}
        filtered={filtered}
        issueCount={issueCount}
        disabledCount={disabledCount}
        filter={filter}
        setFilter={setFilter}
        onTest={handleTest}
        onSetDefault={handleSetDefault}
        onToggleEnabled={handleToggleEnabled}
        onDisconnect={setDisconnectFor}
        onReconnect={handleReconnect}
      />
      <CatalogCard connections={conns} onAdd={handleAdd} />
      <DisconnectDialog
        conn={disconnectFor}
        plugin={disconnectPlugin}
        onClose={cancelDisconnect}
        onConfirm={confirmDisconnect}
      />
    </div>
  );
}

function ConnectionsListCard({
  conns,
  filtered,
  issueCount,
  disabledCount,
  filter,
  setFilter,
  onTest,
  onSetDefault,
  onToggleEnabled,
  onDisconnect,
  onReconnect,
}: {
  conns: ReadonlyArray<MockConnection>;
  filtered: ReadonlyArray<MockConnection>;
  issueCount: number;
  disabledCount: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  onTest: (conn: MockConnection) => void;
  onSetDefault: (conn: MockConnection) => void;
  onToggleEnabled: (conn: MockConnection) => void;
  onDisconnect: (conn: MockConnection) => void;
  onReconnect: (conn: MockConnection) => void;
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
            const plugin = MOCK_PLUGINS.find((p) => p.id === conn.pluginId);
            if (!plugin) return null;
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
                onDisconnect={() => onDisconnect(conn)}
                onReconnect={() => onReconnect(conn)}
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
  conn: MockConnection;
  plugin: MockPlugin;
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
              <span className="text-muted-foreground">{conn.label}</span>
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
        {conn.sublabel ? (
          <span className={plugin.poolable ? "font-mono" : ""}>{conn.sublabel}</span>
        ) : null}
        <span>
          {m.settings_connections_last_verified({
            time: relativeTime(new Date(conn.lastVerifiedAt)),
          })}
        </span>
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
  onDisconnect,
  onReconnect,
}: {
  broken: boolean;
  conn: MockConnection;
  plugin: MockPlugin;
  hasSiblings: boolean;
  onTest: () => void;
  onSetDefault: () => void;
  onToggleEnabled: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {broken ? (
        <Button variant="outline" size="sm" onClick={onReconnect}>
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
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onTest}>
            <RefreshCwIcon className="size-3.5" />
            {m.settings_connections_action_test()}
          </DropdownMenuItem>
          <DropdownMenuItem>
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
  onDisconnect,
  onReconnect,
}: {
  conn: MockConnection;
  plugin: MockPlugin;
  hasSiblings: boolean;
  isFirst: boolean;
  onTest: () => void;
  onSetDefault: () => void;
  onToggleEnabled: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
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
        onDisconnect={onDisconnect}
        onReconnect={onReconnect}
      />
    </li>
  );
}

function CatalogCard({
  connections,
  onAdd,
}: {
  connections: ReadonlyArray<MockConnection>;
  onAdd: (plugin: MockPlugin) => void;
}) {
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_connections_catalog_title()}
        description={m.settings_connections_catalog_description()}
      />
      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
        {MOCK_PLUGINS.map((plugin) => {
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
  conn: MockConnection | null;
  plugin: MockPlugin | null;
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
