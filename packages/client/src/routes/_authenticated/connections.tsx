import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  KeyIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlugIcon,
  PowerIcon,
  RotateCwIcon,
  StarIcon,
  TriangleAlertIcon,
  UnplugIcon,
  XIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { capabilityDisplay } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

import {
  ConnectionModal,
  type ExistingConnection,
  type PluginSummary,
} from "@/components/connections/connection-modal";
import type { JSONSchema } from "@ent-mcp/shared";
import { nonSecretFields } from "@/components/connections/schema-form";

export const Route = createFileRoute("/_authenticated/connections")({
  component: ConnectionsPage,
});

// ─── API shapes (derived from the server response types) ──────────────────────

interface ConnectionItem {
  id: string;
  pluginId: string;
  status: string;
  enabled: boolean;
  isDefault: boolean;
  displayName: string | null;
  tokenExpiresAt: number | null;
  lastVerifiedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  userConfig: unknown;
  plugin: {
    id: string;
    name: string;
    version: string;
    description: string;
    auth: string;
    enabled: boolean;
    logoUrl?: string;
    capabilities: string[];
    userConfigSchema: unknown;
  };
}

interface AvailablePlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  auth: string;
  poolable: boolean;
  adminSharedAvailable: boolean;
  userScopedCapabilities: Array<{ id: string; version: string }>;
  globalScopedCapabilities: Array<{ id: string; version: string }>;
  userConfigSchema: unknown;
  credentialsSchema: unknown;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function useConnectionsQuery() {
  return useQuery({
    queryKey: ["connections", "list"],
    queryFn: async (): Promise<ConnectionItem[]> => {
      const res = await api.connections.$get();
      if (!res.ok) throw new Error("Failed to load connections.");
      const body = (await res.json()) as { connections: ConnectionItem[] };
      return body.connections;
    },
  });
}

function useAvailablePluginsQuery() {
  return useQuery({
    queryKey: ["connections", "available"],
    queryFn: async (): Promise<AvailablePlugin[]> => {
      const res = await api.connections.available.$get();
      if (!res.ok) throw new Error("Failed to load available plugins.");
      const body = (await res.json()) as { plugins: AvailablePlugin[] };
      return body.plugins;
    },
  });
}

// ─── Modal state ──────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "none" }
  | { kind: "create"; plugin: PluginSummary }
  | { kind: "edit"; plugin: PluginSummary; existing: ExistingConnection }
  | { kind: "remove"; connection: ConnectionItem };

function availableToPluginSummary(p: AvailablePlugin): PluginSummary {
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    logoUrl: p.logoUrl,
    auth: p.auth,
    capabilities: [
      ...p.userScopedCapabilities.map((c) => c.id),
      ...p.globalScopedCapabilities.map((c) => c.id),
    ],
    userConfigSchema: (p.userConfigSchema as JSONSchema | null) ?? null,
    hasSharedConfig: p.adminSharedAvailable,
  };
}

function connectedToPluginSummary(c: ConnectionItem): PluginSummary {
  return {
    id: c.plugin.id,
    name: c.plugin.name,
    version: c.plugin.version,
    description: c.plugin.description,
    logoUrl: c.plugin.logoUrl,
    auth: c.plugin.auth,
    capabilities: c.plugin.capabilities,
    userConfigSchema: (c.plugin.userConfigSchema as JSONSchema | null) ?? null,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ConnectionsPage() {
  const connections = useConnectionsQuery();
  const available = useAvailablePluginsQuery();
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const refetch = () => {
    void qc.invalidateQueries({ queryKey: ["connections", "list"] });
    void qc.invalidateQueries({ queryKey: ["connections", "available"] });
  };

  const byPlugin = useMemo(() => groupByPlugin(connections.data ?? []), [connections.data]);
  const connectedPluginIds = useMemo(() => new Set(byPlugin.map((g) => g.pluginId)), [byPlugin]);
  const unconnected = useMemo(
    () => (available.data ?? []).filter((p) => !connectedPluginIds.has(p.id)),
    [available.data, connectedPluginIds],
  );
  const brokenCount = (connections.data ?? []).filter(isBroken).length;
  const expiredOnly = (connections.data ?? []).every((c) => !isBroken(c) || c.status === "expired");
  const hasAnyConnections = (connections.data ?? []).length > 0;
  const hasAnyPlugins = (available.data ?? []).length > 0 || hasAnyConnections;

  const isLoading = connections.isLoading || available.isLoading;

  return (
    <div className="flex flex-col gap-8 px-4 py-4 md:py-6 lg:px-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Connections</h1>
          <p className="mt-1.5 max-w-[64ch] text-sm text-muted-foreground">
            Connect your media services to enable tracking, requesting, and personalized
            recommendations through your AI assistant.
          </p>
        </div>
        {/* Non-admin users get a 403 from /plugins which is fine — the link is harmless. Hide
            behind a client-side permissions hook once one exists. */}
        <Link
          to="/admin/plugins"
          className="hidden shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
        >
          Manage plugins
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </header>

      {isLoading ? (
        <LoadingSkeleton />
      ) : !hasAnyPlugins ? (
        <NoPluginsState />
      ) : !hasAnyConnections ? (
        <EmptyConnectionsState
          plugins={available.data ?? []}
          onConnect={(p) => setModal({ kind: "create", plugin: availableToPluginSummary(p) })}
        />
      ) : (
        <>
          {brokenCount > 0 ? (
            <Alert
              variant={expiredOnly ? "default" : "destructive"}
              className={
                expiredOnly
                  ? "border-amber-500/40 bg-amber-500/8 text-amber-900 dark:text-amber-200"
                  : undefined
              }
            >
              <TriangleAlertIcon />
              <AlertTitle>
                {brokenCount} connection{brokenCount === 1 ? "" : "s"} need
                {brokenCount === 1 ? "s" : ""} attention
              </AlertTitle>
              <AlertDescription>
                {expiredOnly
                  ? "Some services need re-authentication. Use Reconnect on the affected card."
                  : "Features that rely on these services won't work until they're fixed."}
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="flex flex-col gap-10">
            {byPlugin.map((group) => (
              <PluginGroup
                key={group.pluginId}
                group={group}
                onAddAnother={(summary) => setModal({ kind: "create", plugin: summary })}
                onEdit={(connection) =>
                  setModal({
                    kind: "edit",
                    plugin: connectedToPluginSummary(connection),
                    existing: {
                      id: connection.id,
                      displayName: connection.displayName,
                      userConfig: connection.userConfig,
                    },
                  })
                }
                onRemove={(connection) => setModal({ kind: "remove", connection })}
                onReconnect={(connection) => {
                  if (connection.plugin.auth === "form") {
                    setModal({
                      kind: "edit",
                      plugin: connectedToPluginSummary(connection),
                      existing: {
                        id: connection.id,
                        displayName: connection.displayName,
                        userConfig: connection.userConfig,
                      },
                    });
                  } else {
                    setModal({
                      kind: "create",
                      plugin: connectedToPluginSummary(connection),
                    });
                  }
                }}
                onRefetch={refetch}
              />
            ))}
          </section>

          {unconnected.length > 0 ? (
            <AvailableSection
              plugins={unconnected}
              onConnect={(p) =>
                setModal({
                  kind: "create",
                  plugin: availableToPluginSummary(p),
                })
              }
            />
          ) : null}
        </>
      )}

      <ConnectionModal
        open={modal.kind === "create" || modal.kind === "edit"}
        plugin={modal.kind === "create" || modal.kind === "edit" ? modal.plugin : null}
        existing={modal.kind === "edit" ? modal.existing : null}
        onOpenChange={(open) => {
          if (!open) setModal({ kind: "none" });
        }}
        onSuccess={refetch}
      />

      <RemoveDialog
        open={modal.kind === "remove"}
        connection={modal.kind === "remove" ? modal.connection : null}
        onOpenChange={(open) => {
          if (!open) setModal({ kind: "none" });
        }}
        onRemoved={refetch}
      />
    </div>
  );
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

interface PluginGroupData {
  pluginId: string;
  plugin: ConnectionItem["plugin"];
  connections: ConnectionItem[];
  /** True when any connection in the group is broken; such groups float to the top. */
  hasBroken: boolean;
}

function groupByPlugin(items: ConnectionItem[]): PluginGroupData[] {
  const groups = new Map<string, PluginGroupData>();
  for (const c of items) {
    const existing = groups.get(c.pluginId);
    if (existing) {
      existing.connections.push(c);
      if (isBroken(c)) existing.hasBroken = true;
    } else {
      groups.set(c.pluginId, {
        pluginId: c.pluginId,
        plugin: c.plugin,
        connections: [c],
        hasBroken: isBroken(c),
      });
    }
  }
  // Broken groups float to the top; otherwise alphabetical by plugin name.
  return [...groups.values()].sort((a, b) => {
    if (a.hasBroken !== b.hasBroken) return a.hasBroken ? -1 : 1;
    return a.plugin.name.localeCompare(b.plugin.name);
  });
}

function isBroken(c: ConnectionItem): boolean {
  return c.status === "error" || c.status === "expired";
}

// ─── Plugin group section ─────────────────────────────────────────────────────

interface PluginGroupProps {
  group: PluginGroupData;
  onAddAnother: (summary: PluginSummary) => void;
  onEdit: (connection: ConnectionItem) => void;
  onRemove: (connection: ConnectionItem) => void;
  onReconnect: (connection: ConnectionItem) => void;
  onRefetch: () => void;
}

function PluginGroup({
  group,
  onAddAnother,
  onEdit,
  onRemove,
  onReconnect,
  onRefetch,
}: PluginGroupProps) {
  const summary: PluginSummary = {
    id: group.plugin.id,
    name: group.plugin.name,
    version: group.plugin.version,
    description: group.plugin.description,
    logoUrl: group.plugin.logoUrl,
    auth: group.plugin.auth,
    capabilities: group.plugin.capabilities,
    userConfigSchema: (group.plugin.userConfigSchema as JSONSchema | null) ?? null,
  };
  const showDefault = group.connections.length > 1;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-1">
        <div className="flex items-center gap-2">
          {group.plugin.logoUrl ? (
            <img src={group.plugin.logoUrl} alt="" className="size-4 rounded-sm object-contain" />
          ) : null}
          <h3 className="text-lg font-semibold tracking-tight">{group.plugin.name}</h3>
        </div>
        {group.plugin.capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {group.plugin.capabilities.map((cap) => {
              const { label, icon: Icon } = capabilityDisplay(cap);
              return (
                <Badge key={cap} variant="secondary" className="gap-1 text-xs font-normal">
                  <Icon className="size-3 opacity-60" aria-hidden="true" />
                  {label}
                </Badge>
              );
            })}
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {group.connections.map((conn) => (
          <ConnectionCard
            key={conn.id}
            connection={conn}
            showDefault={showDefault}
            onEdit={onEdit}
            onRemove={onRemove}
            onReconnect={onReconnect}
            onRefetch={onRefetch}
          />
        ))}
        <AddAnotherCard plugin={summary} onClick={() => onAddAnother(summary)} />
      </div>
    </section>
  );
}

// ─── Connection card ──────────────────────────────────────────────────────────

interface ConnectionCardProps {
  connection: ConnectionItem;
  showDefault: boolean;
  onEdit: (c: ConnectionItem) => void;
  onRemove: (c: ConnectionItem) => void;
  onReconnect: (c: ConnectionItem) => void;
  onRefetch: () => void;
}

function ConnectionCard({
  connection,
  showDefault,
  onEdit,
  onRemove,
  onReconnect,
  onRefetch,
}: ConnectionCardProps) {
  const { plugin } = connection;
  const disabled = !connection.enabled;
  const broken = isBroken(connection);
  const displayName = connection.displayName ?? plugin.name;

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await api.connections[":id"].test.$post({
        param: { id: connection.id },
      });
      if (!res.ok) throw new Error("Test failed.");
      return await res.json();
    },
  });
  const setEnabledMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await api.connections[":id"].enabled.$patch({
        param: { id: connection.id },
        json: { enabled },
      });
      if (!res.ok) throw new Error("Failed to update.");
    },
    onSuccess: onRefetch,
  });
  const setDefaultMutation = useMutation({
    mutationFn: async () => {
      const res = await api.connections[":id"].default.$post({
        param: { id: connection.id },
      });
      if (!res.ok) throw new Error("Failed to set default.");
    },
    onSuccess: onRefetch,
  });

  // Auto-dismiss the test result after 3 seconds.
  const [showTestResult, setShowTestResult] = useState(false);
  useEffect(() => {
    if (!testMutation.isSuccess && !testMutation.isError) return;
    setShowTestResult(true);
    const id = window.setTimeout(() => setShowTestResult(false), 3000);
    return () => window.clearTimeout(id);
  }, [testMutation.isSuccess, testMutation.isError, testMutation.data]);

  useEffect(() => {
    if (testMutation.isSuccess) onRefetch();
  }, [testMutation.isSuccess, onRefetch]);

  const displayPairs = useMemo(() => {
    if (!plugin.userConfigSchema || !connection.userConfig) return [];
    const schema = plugin.userConfigSchema as JSONSchema;
    const cfg = connection.userConfig as Record<string, unknown>;
    return nonSecretFields(schema)
      .map((f) => ({ ...f, value: cfg[f.name] }))
      .filter((p) => p.value !== undefined && p.value !== null && p.value !== "");
  }, [plugin.userConfigSchema, connection.userConfig]);

  return (
    <Card
      size="sm"
      className={cn(
        "transition-opacity",
        disabled && "opacity-55",
        connection.status === "error" && "ring-destructive/40",
        connection.status === "expired" && "ring-amber-500/50",
      )}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="truncate">{displayName}</span>
          <StatusBadge connection={connection} />
          {showDefault && connection.isDefault ? (
            <Badge variant="outline" className="text-xs font-normal">
              Default
            </Badge>
          ) : null}
        </CardTitle>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More actions"
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending || disabled}
              >
                <CheckIcon /> Test connection
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(connection)}>
                <PencilIcon /> Edit
              </DropdownMenuItem>
              {showDefault && !connection.isDefault && !disabled ? (
                <DropdownMenuItem onClick={() => setDefaultMutation.mutate()}>
                  <StarIcon /> Set as default
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() => setEnabledMutation.mutate(!connection.enabled)}
                disabled={setEnabledMutation.isPending}
              >
                <PowerIcon /> {disabled ? "Enable" : "Disable"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(connection)}>
                <XIcon /> Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 text-sm">
        {displayPairs.length > 0 ? (
          <dl className="flex flex-col gap-1">
            {displayPairs.map((p) => (
              <div key={p.name} className="flex items-baseline gap-2">
                <dt className="shrink-0 text-xs text-muted-foreground">{p.label}</dt>
                <dd
                  className={cn(
                    "flex-1 truncate text-xs",
                    p.isUri && "font-mono text-[11px] text-muted-foreground",
                  )}
                >
                  {renderPrimitive(p.value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {broken ? "Last verified " : "Verified "}
          {formatRelative(connection.lastVerifiedAt)}
        </span>
        {broken && connection.errorMessage ? (
          <span className="text-xs leading-snug text-destructive">{connection.errorMessage}</span>
        ) : null}
      </CardContent>

      <CardFooter className="flex items-center gap-2">
        {broken ? (
          <Button size="sm" onClick={() => onReconnect(connection)}>
            <RotateCwIcon /> Reconnect
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || disabled}
          >
            {testMutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
            {testMutation.isPending ? "Testing…" : "Test connection"}
          </Button>
        )}
        {showTestResult && testMutation.isSuccess && testMutation.data?.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckIcon className="size-3" /> Verified
          </span>
        ) : null}
        {showTestResult && testMutation.data && !testMutation.data.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <XIcon className="size-3" /> {testMutation.data.message ?? "Test failed"}
          </span>
        ) : null}
        {showTestResult && testMutation.isError ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <XIcon className="size-3" /> {(testMutation.error as Error).message}
          </span>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function StatusBadge({ connection }: { connection: ConnectionItem }) {
  const { status, enabled } = connection;
  if (!enabled) {
    return <Badge variant="secondary">Disabled</Badge>;
  }
  if (status === "error") {
    return (
      <Badge variant="destructive">
        <TriangleAlertIcon /> Error
      </Badge>
    );
  }
  if (status === "expired") {
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">
        <TriangleAlertIcon /> Expired
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <CheckIcon /> Connected
    </Badge>
  );
}

// ─── Add another + Available cards ────────────────────────────────────────────

function AddAnotherCard({ plugin, onClick }: { plugin: PluginSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-28 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-5 py-6 text-sm font-medium text-muted-foreground ring-1 ring-transparent transition-all hover:border-foreground hover:bg-accent hover:text-foreground"
    >
      <PlugIcon className="size-4" />
      Add another {plugin.name} connection
    </button>
  );
}

interface AvailableSectionProps {
  plugins: AvailablePlugin[];
  onConnect: (p: AvailablePlugin) => void;
}

function AvailableSection({ plugins, onConnect }: AvailableSectionProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("connections.availableCollapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((next) => {
      const v = !next;
      try {
        window.localStorage.setItem("connections.availableCollapsed", v ? "true" : "false");
      } catch {
        // localStorage unavailable; ignore.
      }
      return v;
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <button
        onClick={toggle}
        className="-mx-2 inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-4" />
        ) : (
          <ChevronDownIcon className="size-4" />
        )}
        Available to connect
        <span className="text-xs text-muted-foreground/70">· {plugins.length}</span>
      </button>
      {!collapsed ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {plugins.map((p) => (
            <AvailablePluginCard key={p.id} plugin={p} onConnect={() => onConnect(p)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AvailablePluginCard({
  plugin,
  onConnect,
}: {
  plugin: AvailablePlugin;
  onConnect: () => void;
}) {
  const capabilityIds = [
    ...plugin.userScopedCapabilities.map((c) => c.id),
    ...plugin.globalScopedCapabilities.map((c) => c.id),
  ];
  return (
    <Card size="sm" className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {plugin.logoUrl ? (
            <img src={plugin.logoUrl} alt="" className="size-4 rounded-sm object-contain" />
          ) : null}
          <span className="truncate">{plugin.name}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {plugin.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {plugin.description}
          </p>
        ) : null}
        {capabilityIds.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {capabilityIds.slice(0, 4).map((cap) => {
              const { label, icon: Icon } = capabilityDisplay(cap);
              return (
                <Badge key={cap} variant="secondary" className="gap-1 text-sm font-normal">
                  <Icon className="size-2.5 opacity-60" aria-hidden="true" />
                  {label}
                </Badge>
              );
            })}
            {capabilityIds.length > 4 ? (
              <span className="text-sm text-muted-foreground">+{capabilityIds.length - 4}</span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2">
        {plugin.adminSharedAvailable ? (
          <>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <KeyIcon className="size-3" /> Using server key
            </span>
            <Button variant="outline" size="sm" onClick={onConnect}>
              Add your own
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onConnect}>
            <UnplugIcon /> Connect
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function EmptyConnectionsState({
  plugins,
  onConnect,
}: {
  plugins: AvailablePlugin[];
  onConnect: (p: AvailablePlugin) => void;
}) {
  return (
    <div className="flex min-h-[55vh] items-center justify-center px-5 py-10">
      <div className="flex w-full max-w-xl flex-col items-center gap-5 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
          <UnplugIcon className="size-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">No services connected</h2>
          <p className="max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
            Connect your media services to start tracking what you watch, requesting downloads, and
            getting personalized recommendations.
          </p>
        </div>
        <div className="mt-1 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {plugins.map((p) => (
            <AvailablePluginCard key={p.id} plugin={p} onConnect={() => onConnect(p)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NoPluginsState() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center px-5 py-10">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card">
          <PlugIcon className="size-6 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">No plugins installed</h2>
        <p className="max-w-[42ch] text-sm text-muted-foreground">
          Ask your administrator to install plugins to connect external services.
        </p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Remove dialog ────────────────────────────────────────────────────────────

function RemoveDialog({
  open,
  connection,
  onOpenChange,
  onRemoved,
}: {
  open: boolean;
  connection: ConnectionItem | null;
  onOpenChange: (next: boolean) => void;
  onRemoved: () => void;
}) {
  const [pending, setPending] = useState(false);
  if (!connection) return null;

  const name = connection.displayName ?? connection.plugin.name;
  const onConfirm = async () => {
    setPending(true);
    try {
      const res = await api.connections[":id"].$delete({
        param: { id: connection.id },
      });
      if (!res.ok) throw new Error("Failed to remove connection.");
      onRemoved();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="gap-0 p-0 sm:max-w-110" showCloseButton={!pending}>
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-destructive">
            Remove {connection.plugin.name} connection?
          </DialogTitle>
          <DialogDescription>
            This will remove your {connection.plugin.name} connection &ldquo;
            {name}&rdquo;. Your data on {connection.plugin.name} is not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Remove connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPrimitive(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function formatRelative(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}
