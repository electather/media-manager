import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CogIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  TrashIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { capabilityDisplay } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { JSONSchema } from "@ent-mcp/shared";
import type { PersonalKeyFallbackPolicy, PluginManifest } from "@ent-mcp/shared/plugins";
import {
  SchemaForm,
  defaultsFromSchema,
  stripEmptySecrets,
  validateSchema,
} from "@/components/connections/schema-form";

export const Route = createFileRoute("/_authenticated/admin/plugins")({
  component: AdminPluginsPage,
});

interface PluginRow {
  id: string;
  version: string;
  sourceType: string;
  enabled: boolean;
  hasGlobalConfig: boolean;
  sharedCredentialsCount: number;
  personalKeyFallback: PersonalKeyFallbackPolicy;
  poolable: boolean;
  capabilities: Array<{ id: string; version: string; scope: "global" | "user" }>;
  manifest: PluginManifest;
  isPureGlobal: boolean;
  installedAt: number;
  updatedAt: number;
  isBuiltin: boolean;
}

interface SharedCredentialEntry {
  id: string;
  label: string;
  enabled: boolean;
  lastExhaustedAt: number | null;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
}

type ModalState =
  | { kind: "none" }
  | { kind: "configure"; plugin: PluginRow }
  | { kind: "uninstall"; plugin: PluginRow };

function AdminPluginsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const plugins = useQuery({
    queryKey: ["admin", "plugins"],
    queryFn: async (): Promise<PluginRow[]> => {
      const res = await api.plugins.$get();
      if (!res.ok) throw new Error("Failed to load plugins.");
      const body = (await res.json()) as { plugins: PluginRow[] };
      return body.plugins;
    },
  });

  const refetch = () => void qc.invalidateQueries({ queryKey: ["admin", "plugins"] });

  return (
    <div className="flex flex-col gap-8 px-4 py-4 md:py-6 lg:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Plugins</h1>
          <p className="mt-1.5 max-w-[64ch] text-sm text-muted-foreground">
            Manage plugins that provide external service integrations. Enable or disable, edit
            admin-level configuration, and uninstall third-party plugins.
          </p>
        </div>
        {/* Install flow is out of scope in v1: the loader only handles built-in modules.
            When URL-based installs are supported, wire up an Install Plugin button here. */}
      </header>

      {plugins.isLoading ? (
        <LoadingSkeleton />
      ) : (plugins.data?.length ?? 0) === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {plugins.data!.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onConfigure={() => setModal({ kind: "configure", plugin })}
              onUninstall={() => setModal({ kind: "uninstall", plugin })}
              onRefetch={refetch}
            />
          ))}
        </div>
      )}

      <ConfigureDialog
        state={modal}
        onOpenChange={(open) => {
          if (!open) setModal({ kind: "none" });
        }}
        onSaved={refetch}
      />
      <UninstallDialog
        state={modal}
        onOpenChange={(open) => {
          if (!open) setModal({ kind: "none" });
        }}
        onRemoved={refetch}
      />
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface PluginCardProps {
  plugin: PluginRow;
  onConfigure: () => void;
  onUninstall: () => void;
  onRefetch: () => void;
}

function PluginCard({ plugin, onConfigure, onUninstall, onRefetch }: PluginCardProps) {
  const setEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await api.plugins[":id"].enabled.$patch({
        param: { id: plugin.id },
        json: { enabled },
      });
      if (!res.ok) throw new Error("Failed to update plugin.");
    },
    onSuccess: onRefetch,
  });

  const hasGlobalConfig = Boolean(plugin.manifest.globalConfigSchema);
  const hasSharedCredentialsSchema = Boolean(plugin.manifest.sharedCredentialsSchema);
  const isConfigurable = hasGlobalConfig || hasSharedCredentialsSchema;
  const capabilities = Object.keys(plugin.manifest.capabilities ?? {});
  const disabled = !plugin.enabled;

  return (
    <Card size="sm" className={cn("gap-3 transition-opacity", disabled && "opacity-60")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {plugin.manifest.logoUrl ? (
            <img
              src={plugin.manifest.logoUrl}
              alt=""
              className="size-4 rounded-sm object-contain"
            />
          ) : null}
          <span>{plugin.manifest.name}</span>
          <span className="text-xs font-normal tracking-wide text-muted-foreground">
            v{plugin.version}
          </span>
          <Badge
            variant={plugin.isBuiltin ? "secondary" : "outline"}
            className="text-xs font-normal"
          >
            {plugin.isBuiltin ? (
              <>
                <BadgeCheck /> Built-in
              </>
            ) : (
              sourceLabel(plugin.sourceType)
            )}
          </Badge>
          {disabled ? (
            <Badge variant="secondary" className="text-xs font-normal">
              Disabled
            </Badge>
          ) : null}
        </CardTitle>
        <CardAction>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">{plugin.enabled ? "Enabled" : "Disabled"}</span>
              <Switch
                checked={plugin.enabled}
                onCheckedChange={(next: boolean) => setEnabled.mutate(next)}
                disabled={setEnabled.isPending}
                aria-label={plugin.enabled ? "Disable plugin" : "Enable plugin"}
              />
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More actions"
                className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <MoreHorizontalIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onConfigure} disabled={!isConfigurable}>
                  <CogIcon /> Configure
                </DropdownMenuItem>
                {!plugin.isBuiltin ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={onUninstall}>
                      <TrashIcon /> Uninstall
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {plugin.manifest.description ? (
          <p className="text-sm text-muted-foreground">{plugin.manifest.description}</p>
        ) : null}
        {capabilities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {capabilities.map((cap) => {
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
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>
            Auth: <span className="font-medium text-foreground">{plugin.manifest.auth.kind}</span>
          </span>
          {hasGlobalConfig ? (
            <span>
              Global config:{" "}
              <span className="font-medium text-foreground">
                {plugin.hasGlobalConfig ? "set" : "not set"}
              </span>
            </span>
          ) : null}
          {hasSharedCredentialsSchema ? (
            <span>
              Shared credentials:{" "}
              <span className="font-medium text-foreground">
                {plugin.sharedCredentialsCount > 0
                  ? plugin.poolable
                    ? `${plugin.sharedCredentialsCount} in pool`
                    : "set"
                  : "not set"}
              </span>
            </span>
          ) : null}
          <span>Installed {formatDate(plugin.installedAt)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Configure dialog ─────────────────────────────────────────────────────────

function ConfigureDialog({
  state,
  onOpenChange,
  onSaved,
}: {
  state: ModalState;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const open = state.kind === "configure";
  const plugin = state.kind === "configure" ? state.plugin : null;
  const configSchema = (plugin?.manifest.globalConfigSchema ?? null) as JSONSchema | null;
  const credsSchema = (plugin?.manifest.sharedCredentialsSchema ?? null) as JSONSchema | null;
  const hasConfig = Boolean(configSchema);
  const hasCreds = Boolean(credsSchema);
  const hasBoth = hasConfig && hasCreds;

  const [tab, setTab] = useState<"config" | "credentials">(hasConfig ? "config" : "credentials");

  useEffect(() => {
    if (!open) return;
    setTab(hasConfig ? "config" : "credentials");
  }, [open, hasConfig]);

  if (!plugin || (!hasConfig && !hasCreds)) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-140">
        <DialogHeader className="border-b border-border px-6 pt-5 pb-4">
          <DialogTitle>Configure {plugin.manifest.name}</DialogTitle>
          <DialogDescription>
            Admin-level configuration for this plugin. Secret fields stay encrypted on the server
            and are never displayed after save.
          </DialogDescription>
        </DialogHeader>
        {hasBoth ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "config" | "credentials")}>
            <TabsList className="mx-6 mt-5 w-auto">
              <TabsTrigger value="config">Global config</TabsTrigger>
              <TabsTrigger value="credentials">Shared credentials</TabsTrigger>
            </TabsList>
            <TabsContent value="config" className="mt-0">
              <GlobalConfigTab
                plugin={plugin}
                schema={configSchema!}
                onClose={() => onOpenChange(false)}
                onSaved={onSaved}
              />
            </TabsContent>
            <TabsContent value="credentials" className="mt-0">
              <SharedCredentialsPool plugin={plugin} schema={credsSchema!} onChanged={onSaved} />
            </TabsContent>
          </Tabs>
        ) : hasConfig ? (
          <GlobalConfigTab
            plugin={plugin}
            schema={configSchema!}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : (
          <SharedCredentialsPool plugin={plugin} schema={credsSchema!} onChanged={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GlobalConfigTab({
  plugin,
  schema,
  onClose,
  onSaved,
}: {
  plugin: PluginRow;
  schema: JSONSchema;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsFromSchema(schema));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setTopError(null);
    setValues(defaultsFromSchema(schema));
    void (async () => {
      try {
        const res = await api.plugins[":id"]["global-config"].$get({ param: { id: plugin.id } });
        if (!res.ok) throw new Error("Failed to load config.");
        const body = (await res.json()) as { config: unknown };
        if (cancelled) return;
        if (body.config && typeof body.config === "object") {
          setValues({
            ...defaultsFromSchema(schema),
            ...(body.config as Record<string, unknown>),
          });
        }
      } catch (err) {
        if (!cancelled) setTopError(err instanceof Error ? err.message : "Failed to load config.");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plugin.id, schema]);

  const onSave = async () => {
    const errors = validateSchema(schema, values);
    if (Object.keys(errors).length > 0) {
      setSubmitAttempted(true);
      return;
    }
    setSaving(true);
    setTopError(null);
    try {
      const submission = stripEmptySecrets(schema, values);
      const res = await api.plugins[":id"]["global-config"].$put({
        param: { id: plugin.id },
        json: { config: submission },
      });
      if (!res.ok) throw new Error("Failed to save config.");
      onSaved();
      onClose();
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 px-6 py-5">
        {!loaded ? (
          <Skeleton className="h-24" />
        ) : (
          <SchemaForm
            schema={schema}
            value={values}
            onChange={setValues}
            mode="edit"
            submitAttempted={submitAttempted}
          />
        )}
        {topError ? <InlineError message={topError} /> : null}
      </div>
      <DialogFooter className="border-t border-border px-6 py-4">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={saving || !loaded}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Shared credentials pool ──────────────────────────────────────────────────

function SharedCredentialsPool({
  plugin,
  schema,
  onChanged,
}: {
  plugin: PluginRow;
  schema: JSONSchema;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const entries = useQuery({
    queryKey: ["admin", "plugins", plugin.id, "shared-credentials"],
    queryFn: async (): Promise<SharedCredentialEntry[]> => {
      const res = await api.plugins[":id"]["shared-credentials"].$get({ param: { id: plugin.id } });
      if (!res.ok) throw new Error("Failed to load shared credentials.");
      const body = (await res.json()) as { entries: SharedCredentialEntry[] };
      return body.entries;
    },
  });

  const refetch = () => {
    void qc.invalidateQueries({
      queryKey: ["admin", "plugins", plugin.id, "shared-credentials"],
    });
    onChanged();
  };

  const [mode, setMode] = useState<
    { kind: "list" } | { kind: "add" } | { kind: "edit"; entry: SharedCredentialEntry }
  >({
    kind: "list",
  });

  // Reset to list whenever the plugin changes.
  useEffect(() => {
    setMode({ kind: "list" });
  }, [plugin.id]);

  const list = entries.data ?? [];
  const atCapacity = !plugin.poolable && list.length >= 1;

  if (mode.kind === "add") {
    return (
      <SharedCredentialForm
        plugin={plugin}
        schema={schema}
        mode="add"
        onCancel={() => setMode({ kind: "list" })}
        onSaved={() => {
          setMode({ kind: "list" });
          refetch();
        }}
      />
    );
  }
  if (mode.kind === "edit") {
    return (
      <SharedCredentialForm
        plugin={plugin}
        schema={schema}
        mode="edit"
        entry={mode.entry}
        onCancel={() => setMode({ kind: "list" })}
        onSaved={() => {
          setMode({ kind: "list" });
          refetch();
        }}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 px-6 py-5">
        {entries.isLoading ? (
          <Skeleton className="h-24" />
        ) : entries.error ? (
          <InlineError message={(entries.error as Error).message} />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shared credentials configured. Add one so {plugin.manifest.name} can make
            {plugin.poolable ? " pooled " : " "}
            global calls on behalf of users without their own connection.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {list.map((entry) => (
              <SharedCredentialRow
                key={entry.id}
                plugin={plugin}
                entry={entry}
                onEdit={() => setMode({ kind: "edit", entry })}
                onChanged={refetch}
              />
            ))}
          </ul>
        )}
      </div>
      <DialogFooter className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
        <span className="text-xs text-muted-foreground">
          {plugin.poolable
            ? "Multiple credentials can be pooled and rotated on rate-limit."
            : "This plugin accepts a single shared credential."}
        </span>
        <Button onClick={() => setMode({ kind: "add" })} disabled={atCapacity}>
          Add credential
        </Button>
      </DialogFooter>
    </>
  );
}

function SharedCredentialRow({
  plugin,
  entry,
  onEdit,
  onChanged,
}: {
  plugin: PluginRow;
  entry: SharedCredentialEntry;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"toggle" | "test" | "delete" | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleEnabled = async (next: boolean) => {
    setBusy("toggle");
    setError(null);
    try {
      const res = await api.plugins[":id"]["shared-credentials"][":credId"].$patch({
        param: { id: plugin.id, credId: entry.id },
        json: { enabled: next },
      });
      if (!res.ok) throw new Error("Failed to update.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setError(null);
    setTestResult(null);
    try {
      const res = await api.plugins[":id"]["shared-credentials"][":credId"].test.$post({
        param: { id: plugin.id, credId: entry.id },
      });
      if (!res.ok) throw new Error("Test failed.");
      const body = (await res.json()) as { ok: boolean; message?: string };
      setTestResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete shared credential "${entry.label}"?`)) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await api.plugins[":id"]["shared-credentials"][":credId"].$delete({
        param: { id: plugin.id, credId: entry.id },
      });
      if (!res.ok) throw new Error("Failed to delete.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{entry.label}</div>
          <div className="text-xs text-muted-foreground">
            {entry.lastExhaustedAt
              ? `Rate-limited ${formatDate(entry.lastExhaustedAt)}`
              : `Added ${formatDate(entry.createdAt)}`}
          </div>
        </div>
        <Switch
          checked={entry.enabled}
          onCheckedChange={toggleEnabled}
          disabled={busy !== null}
          aria-label={entry.enabled ? "Disable credential" : "Enable credential"}
        />
        <Button variant="outline" size="sm" onClick={test} disabled={busy !== null}>
          {busy === "test" ? <LoaderCircleIcon className="animate-spin" /> : null}
          Test
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit} disabled={busy !== null}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={remove} disabled={busy !== null}>
          {busy === "delete" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <TrashIcon className="text-destructive" />
          )}
        </Button>
      </div>
      {testResult ? (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-xs",
            testResult.ok
              ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-destructive/40 bg-destructive/5 text-destructive",
          )}
        >
          {testResult.ok ? "OK" : (testResult.message ?? "Test failed.")}
        </div>
      ) : null}
      {error ? <InlineError message={error} /> : null}
    </li>
  );
}

function SharedCredentialForm({
  plugin,
  schema,
  mode,
  entry,
  onCancel,
  onSaved,
}: {
  plugin: PluginRow;
  schema: JSONSchema;
  mode: "add" | "edit";
  entry?: SharedCredentialEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(entry?.label ?? "");
  // On edit, value fields start empty — the server doesn't return the decrypted
  // secret. An empty submission preserves the existing value; filled submission
  // replaces it.
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsFromSchema(schema));
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const onSave = async () => {
    if (label.trim() === "") {
      setSubmitAttempted(true);
      setTopError("Label is required.");
      return;
    }
    // On add, the value must validate. On edit, only validate if the admin
    // actually filled in new secret values.
    const hasFilledValues = Object.values(values).some((v) => v !== "" && v !== undefined);
    if (mode === "add" || hasFilledValues) {
      const errors = validateSchema(schema, values);
      if (Object.keys(errors).length > 0) {
        setSubmitAttempted(true);
        return;
      }
    }
    setSaving(true);
    setTopError(null);
    try {
      if (mode === "add") {
        const submission = stripEmptySecrets(schema, values);
        const res = await api.plugins[":id"]["shared-credentials"].$post({
          param: { id: plugin.id },
          json: { label: label.trim(), value: submission },
        });
        if (!res.ok) throw new Error("Failed to add credential.");
      } else if (entry) {
        const patch: { label?: string; value?: unknown } = {};
        if (label.trim() !== entry.label) patch.label = label.trim();
        if (hasFilledValues) patch.value = stripEmptySecrets(schema, values);
        const res = await api.plugins[":id"]["shared-credentials"][":credId"].$patch({
          param: { id: plugin.id, credId: entry.id },
          json: patch,
        });
        if (!res.ok) throw new Error("Failed to update credential.");
      }
      onSaved();
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 px-6 py-5">
        <Field>
          <FieldTitle>Label</FieldTitle>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Primary TMDB key"
            disabled={saving}
          />
          <FieldDescription>
            A short name for this entry. Helps you identify it in the pool.
          </FieldDescription>
        </Field>
        <SchemaForm
          schema={schema}
          value={values}
          onChange={setValues}
          mode={mode === "add" ? "create" : "edit"}
          submitAttempted={submitAttempted}
        />
        {mode === "edit" ? (
          <p className="text-xs text-muted-foreground">
            Leave secret fields empty to keep the existing value.
          </p>
        ) : null}
        {topError ? <InlineError message={topError} /> : null}
      </div>
      <DialogFooter className="border-t border-border px-6 py-4">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          {mode === "add" ? "Add" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

// ─── Uninstall dialog (typed-name confirmation) ───────────────────────────────

function UninstallDialog({
  state,
  onOpenChange,
  onRemoved,
}: {
  state: ModalState;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const open = state.kind === "uninstall";
  const plugin = state.kind === "uninstall" ? state.plugin : null;
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setPending(false);
      setTopError(null);
    }
  }, [open]);

  if (!plugin) return null;

  const confirm = async () => {
    setPending(true);
    setTopError(null);
    try {
      const res = await api.plugins[":id"].$delete({
        param: { id: plugin.id },
      });
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to uninstall.");
      }
      onRemoved();
      onOpenChange(false);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Failed to uninstall.");
    } finally {
      setPending(false);
    }
  };

  const match = typed.trim() === plugin.manifest.name;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="gap-0 p-0 sm:max-w-120">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="text-destructive">Uninstall {plugin.manifest.name}?</DialogTitle>
          <DialogDescription>
            This removes the plugin and deletes every user connection associated with it. Data on
            the external service is not affected. To confirm, type{" "}
            <strong className="font-medium text-foreground">{plugin.manifest.name}</strong> below.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-4">
          <Field>
            <FieldTitle>Plugin name</FieldTitle>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={plugin.manifest.name}
              disabled={pending}
            />
            <FieldDescription>Must match exactly.</FieldDescription>
          </Field>
          {topError ? <p className="mt-3 text-sm text-destructive">{topError}</p> : null}
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={!match || pending}>
            {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Uninstall plugin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Empty + skeleton ─────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <h2 className="text-lg font-semibold">No plugins installed</h2>
        <p className="text-sm text-muted-foreground">
          Built-in plugins register on server boot. If the list is empty, check the server logs for
          startup errors.
        </p>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-40" />
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sourceLabel(sourceType: string): string {
  if (sourceType === "builtin") return "Built-in";
  if (sourceType === "url") return "URL";
  return sourceType;
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return "";
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
