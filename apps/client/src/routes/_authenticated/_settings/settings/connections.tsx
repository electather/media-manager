import { useEffect, useMemo, useState } from "react";
import type { InferResponseType } from "hono/client";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CheckIcon,
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

import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
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
import { api } from "@/shared/lib/api";
import { CapabilityBadges, capabilityListSummary } from "@/shared/lib/capabilities";
import { relativeTime } from "@/shared/lib/relative-time";
import { cn } from "@/shared/lib/utils";

import {
  ConnectionModal,
  type ExistingConnection,
  type PluginSummary,
} from "@/features/connections";

export const Route = createFileRoute("/_authenticated/_settings/settings/connections")({
  component: ConnectionsPage,
});

// ─── API shapes (inferred from the server response types) ────────────────────

type ConnectionItem = InferResponseType<typeof api.connections.$get>["connections"][number];
type AvailablePlugin = InferResponseType<typeof api.connections.available.$get>["plugins"][number];

// ─── Queries ──────────────────────────────────────────────────────────────────

function useConnectionsQuery() {
  return useQuery({
    queryKey: ["connections", "list"],
    queryFn: async () => {
      const res = await api.connections.$get();
      if (!res.ok) throw new Error("Failed to load connections.");
      const body = await res.json();
      return body.connections;
    },
  });
}

function useAvailablePluginsQuery() {
  return useQuery({
    queryKey: ["connections", "available"],
    queryFn: async () => {
      const res = await api.connections.available.$get();
      if (!res.ok) throw new Error("Failed to load available plugins.");
      const body = await res.json();
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

// ─── Page ─────────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
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
  const hasAnyConnections = byPlugin.length > 0;
  const hasAnyAvailable = unconnected.length > 0;
  const hasAnyPlugins = hasAnyAvailable || hasAnyConnections;

  const isLoading = connections.isLoading || available.isLoading;

  const openCreate = (plugin: PluginSummary) => setModal({ kind: "create", plugin });
  const openEdit = (connection: ConnectionItem) =>
    setModal({
      kind: "edit",
      plugin: connection.plugin,
      existing: { id: connection.id, displayName: connection.displayName },
    });
  const openReconnect = (connection: ConnectionItem) => {
    if (connection.plugin.authKind === "form") openEdit(connection);
    else setModal({ kind: "create", plugin: connection.plugin });
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader />

      {brokenCount > 0 ? <BrokenAlert count={brokenCount} expiredOnly={expiredOnly} /> : null}

      {isLoading ? (
        <LoadingSkeleton />
      ) : !hasAnyPlugins ? (
        <NoPluginsState />
      ) : (
        <>
          {hasAnyConnections ? (
            <ConnectedSection
              groups={byPlugin}
              onAddAnother={openCreate}
              onEdit={openEdit}
              onRemove={(c) => setModal({ kind: "remove", connection: c })}
              onReconnect={openReconnect}
              onRefetch={refetch}
            />
          ) : null}

          {hasAnyAvailable ? (
            <AvailableSection plugins={unconnected} onConnect={openCreate} />
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

function PageHeader() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-medium">Connections</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your media services to enable tracking, requesting, and personalized
          recommendations through your AI assistant.
        </p>
      </div>
      {/* Non-admin users get a 403 from /plugins which is fine — the link is harmless. Hide
          behind a client-side permissions hook once one exists. */}
      <Link
        to="/admin/plugins"
        className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground md:inline-flex"
      >
        Manage plugins
        <ArrowRightIcon className="size-3.5" />
      </Link>
    </div>
  );
}

// fallow-ignore-next-line complexity
function BrokenAlert({ count, expiredOnly }: { count: number; expiredOnly: boolean }) {
  return (
    <Alert
      variant={expiredOnly ? "default" : "destructive"}
      className={cn(
        "max-w-2xl",
        expiredOnly && "border-amber-500/40 bg-amber-500/8 text-amber-900 dark:text-amber-200",
      )}
    >
      <TriangleAlertIcon />
      <AlertTitle>
        {count} connection{count === 1 ? "" : "s"} need{count === 1 ? "s" : ""} attention
      </AlertTitle>
      <AlertDescription>
        {expiredOnly
          ? "Some services need re-authentication. Use Reconnect on the affected card."
          : "Features that rely on these services won't work until they're fixed."}
      </AlertDescription>
    </Alert>
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

// ─── Connected section ────────────────────────────────────────────────────────

interface ConnectedSectionProps {
  groups: PluginGroupData[];
  onAddAnother: (plugin: PluginSummary) => void;
  onEdit: (connection: ConnectionItem) => void;
  onRemove: (connection: ConnectionItem) => void;
  onReconnect: (connection: ConnectionItem) => void;
  onRefetch: () => void;
}

function ConnectedSection({
  groups,
  onAddAnother,
  onEdit,
  onRemove,
  onReconnect,
  onRefetch,
}: ConnectedSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Your connections</h3>
        <p className="text-xs text-muted-foreground">Plugins you've authorized for your account.</p>
      </div>
      <div className="flex max-w-2xl flex-col gap-6">
        {groups.map((group) => (
          <PluginGroup
            key={group.pluginId}
            group={group}
            onAddAnother={onAddAnother}
            onEdit={onEdit}
            onRemove={onRemove}
            onReconnect={onReconnect}
            onRefetch={onRefetch}
          />
        ))}
      </div>
    </section>
  );
}

interface PluginGroupProps {
  group: PluginGroupData;
  onAddAnother: (plugin: PluginSummary) => void;
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
  // Group header lists only the user-scoped capabilities — those are what a
  // connection unlocks for the user. Global-scoped ones don't depend on a
  // connection and live on the modal's "also provides" line instead.
  const userScopedCaps = group.plugin.userScopedCapabilities;
  // Per design doc § "Connected instance card": poolable plugins always
  // surface "Set as default" (rotation assumes one); non-poolable plugins
  // surface it only once the user has multiple instances.
  const showDefault = group.plugin.poolable || group.connections.length > 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {group.plugin.logoUrl ? (
          <img src={group.plugin.logoUrl} alt="" className="size-4 rounded-sm object-contain" />
        ) : null}
        <h4 className="text-sm font-medium">{group.plugin.name}</h4>
        <CapabilityBadges entries={userScopedCaps} size="sm" />
      </div>
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {group.connections.map((conn) => (
          <ConnectionRow
            key={conn.id}
            connection={conn}
            showDefault={showDefault}
            onEdit={onEdit}
            onRemove={onRemove}
            onReconnect={onReconnect}
            onRefetch={onRefetch}
          />
        ))}
        <button
          type="button"
          onClick={() => onAddAnother(group.plugin)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PlugIcon className="size-3.5" />
          Add another {group.plugin.name} connection
        </button>
      </div>
    </div>
  );
}

// ─── Connection row ───────────────────────────────────────────────────────────

interface ConnectionRowProps {
  connection: ConnectionItem;
  showDefault: boolean;
  onEdit: (c: ConnectionItem) => void;
  onRemove: (c: ConnectionItem) => void;
  onReconnect: (c: ConnectionItem) => void;
  onRefetch: () => void;
}

// fallow-ignore-next-line complexity
function ConnectionRow({
  connection,
  showDefault,
  onEdit,
  onRemove,
  onReconnect,
  onRefetch,
}: ConnectionRowProps) {
  const { plugin } = connection;
  const disabled = !connection.enabled;
  const broken = isBroken(connection);
  const displayName = connection.displayName ?? plugin.name;

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await api.connections[":id"].test.$post({ param: { id: connection.id } });
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

  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-4 py-3 transition-opacity sm:flex-row sm:items-start",
        disabled && "opacity-55",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
          <StatusBadge connection={connection} />
          {showDefault && connection.isDefault ? (
            <Badge variant="outline" className="text-xs font-normal">
              Default
            </Badge>
          ) : null}
        </div>

        {connection.displayFields.length > 0 ? (
          <dl className="flex flex-col gap-0.5">
            {connection.displayFields.map((p, i) => (
              // Index suffix guards against the (theoretical) case of two
              // schema properties sharing the same `title`.
              <div key={`${p.label}-${i}`} className="flex items-baseline gap-2">
                <dt className="shrink-0 text-xs text-muted-foreground">{p.label}</dt>
                <dd
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    p.mono && "font-mono text-sm text-muted-foreground",
                  )}
                >
                  {p.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <span className="text-xs text-muted-foreground">
          {broken ? "Last verified " : "Verified "}
          {relativeTime(connection.lastVerifiedAt)}
        </span>
        {broken && connection.errorMessage ? (
          <span className="text-xs leading-snug text-destructive">{connection.errorMessage}</span>
        ) : null}

        {showTestResult ? (
          <RowFeedback
            data={testMutation.data}
            isError={testMutation.isError}
            error={testMutation.error}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-1 self-start sm:self-center">
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
            {testMutation.isPending ? "Testing…" : "Test"}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
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
      </div>
    </div>
  );
}

// fallow-ignore-next-line complexity
function RowFeedback({
  data,
  isError,
  error,
}: {
  data: { ok: boolean; message?: string } | undefined;
  isError: boolean;
  error: unknown;
}) {
  if (data?.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckIcon className="size-3" /> Verified
      </span>
    );
  }
  if (data && !data.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XIcon className="size-3" /> {data.message ?? "Test failed"}
      </span>
    );
  }
  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XIcon className="size-3" /> {(error as Error).message}
      </span>
    );
  }
  return null;
}

// fallow-ignore-next-line complexity
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
  if (status === "disconnected") {
    return <Badge variant="outline">Disconnected</Badge>;
  }
  return (
    <Badge variant="secondary">
      <CheckIcon /> Connected
    </Badge>
  );
}

// ─── Available section ────────────────────────────────────────────────────────

interface AvailableSectionProps {
  plugins: AvailablePlugin[];
  onConnect: (p: AvailablePlugin) => void;
}

function AvailableSection({ plugins, onConnect }: AvailableSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Available to connect</h3>
        <p className="text-xs text-muted-foreground">Services you can connect to.</p>
      </div>
      <div className="flex max-w-2xl flex-col divide-y divide-border rounded-xl border border-border">
        {plugins.map((p) => (
          <AvailableRow key={p.id} plugin={p} onConnect={() => onConnect(p)} />
        ))}
      </div>
    </section>
  );
}

// fallow-ignore-next-line complexity
function AvailableRow({ plugin, onConnect }: { plugin: AvailablePlugin; onConnect: () => void }) {
  // Per the design doc § "Available to Connect": badges represent only the
  // user-scoped capabilities (what a connection unlocks); a muted footer
  // line lists the global-scoped ones with "available without a connection".
  const userScopedCaps = plugin.userScopedCapabilities;
  const globalScopedCaps = plugin.globalScopedCapabilities;

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {plugin.logoUrl ? (
            <img src={plugin.logoUrl} alt="" className="size-4 rounded-sm object-contain" />
          ) : null}
          <span className="truncate text-sm font-medium">{plugin.name}</span>
        </div>
        {plugin.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {plugin.description}
          </p>
        ) : null}
        {userScopedCaps.length > 0 ? <CapabilityBadges entries={userScopedCaps} size="sm" /> : null}
        {globalScopedCaps.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            <span className="sr-only">Also available without a connection: </span>
            {capabilityListSummary(globalScopedCaps)} available without a connection
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 self-start sm:self-center">
        {plugin.adminSharedAvailable ? (
          <>
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <KeyIcon className="size-3" /> Using server key
            </span>
            <Button variant="outline" size="sm" onClick={onConnect}>
              Add your own key
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onConnect}>
            <UnplugIcon /> Connect
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Empty + skeleton states ─────────────────────────────────────────────────

function NoPluginsState() {
  return (
    <div className="flex max-w-2xl flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-9 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card">
        <PlugIcon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">No plugins installed</p>
      <p className="max-w-[42ch] text-xs text-muted-foreground">
        Ask your administrator to install plugins to connect external services.
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-32 w-full rounded-xl" />
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
