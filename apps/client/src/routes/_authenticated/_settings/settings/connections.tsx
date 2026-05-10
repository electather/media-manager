// fallow-ignore-file complexity
import { useMemo, useState } from "react";
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
import { ConnectionStatusPill } from "@/features/settings/components/connection-status-pill";
import {
  MOCK_CONNECTIONS,
  MOCK_PLUGINS,
  type MockConnection,
  type MockPlugin,
} from "@/features/settings/mocks";

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

function ConnectionsPage() {
  const [conns, setConns] = useState<ReadonlyArray<MockConnection>>(MOCK_CONNECTIONS);
  const [filter, setFilter] = useState<Filter>("all");
  const [disconnectFor, setDisconnectFor] = useState<MockConnection | null>(null);

  const sorted = useMemo(() => {
    const order: Record<MockConnection["status"], number> = {
      error: 0,
      expired: 1,
      connected: 2,
      disconnected: 3,
    };
    return [...conns].sort((a, b) => {
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
    window.setTimeout(() => {
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

  const confirmDisconnect = () => {
    if (!disconnectFor) return;
    setConns((list) => list.filter((c) => c.id !== disconnectFor.id));
    setDisconnectFor(null);
    toast.success(m.settings_connections_toast_disconnected());
  };

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_connections_title()}
        description={m.settings_connections_description()}
      />

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
                  onTest={() => handleTest(conn)}
                  onSetDefault={() => handleSetDefault(conn)}
                  onToggleEnabled={() => handleToggleEnabled(conn)}
                  onDisconnect={() => setDisconnectFor(conn)}
                  onReconnect={() =>
                    updateConnection(conn.id, {
                      status: "connected",
                      enabled: true,
                      errorMessage: undefined,
                    })
                  }
                />
              );
            })}
          </ul>
        )}
      </SettingsCard>

      <CatalogCard
        connections={conns}
        onAdd={(plugin) => {
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
        }}
      />

      <DisconnectDialog
        conn={disconnectFor}
        plugin={
          disconnectFor ? (MOCK_PLUGINS.find((p) => p.id === disconnectFor.pluginId) ?? null) : null
        }
        onClose={() => setDisconnectFor(null)}
        onConfirm={confirmDisconnect}
      />
    </div>
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
    <div className="flex gap-1.5" role="tablist" aria-label="Filter connections">
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

      <ConnectionLogo plugin={plugin} />

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
          <ConnectionStatusPill status={conn.status} />
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
                aria-label={m.settings_connections_action_more()}
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
    </li>
  );
}

function ConnectionLogo({ plugin }: { plugin: MockPlugin }) {
  const initial = plugin.name.charAt(0).toUpperCase();
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-base font-semibold text-foreground"
      aria-hidden="true"
    >
      {initial}
    </div>
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
                <ConnectionLogo plugin={plugin} />
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
