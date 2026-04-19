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
import {
  type JSONSchema,
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
  hasSharedCredentials: boolean;
  manifest: {
    id: string;
    name: string;
    version: string;
    description?: string;
    logoUrl?: string;
    capabilities?: Record<string, string>;
    globalConfigSchema?: JSONSchema;
    credentialsSchema?: JSONSchema;
    allowsSharedCredentials?: boolean;
    auth: { kind: string };
  };
  installedAt: number;
  updatedAt: number;
  isBuiltin: boolean;
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
  const hasSharedCredentials = Boolean(plugin.manifest.allowsSharedCredentials);
  const isConfigurable = hasGlobalConfig || hasSharedCredentials;
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
          {hasSharedCredentials ? (
            <span>
              Shared credentials:{" "}
              <span className="font-medium text-foreground">
                {plugin.hasSharedCredentials ? "set" : "not set"}
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
  const credsSchema = (
    plugin?.manifest.allowsSharedCredentials ? plugin.manifest.credentialsSchema : null
  ) as JSONSchema | null;
  const hasBoth = Boolean(configSchema && credsSchema);

  const [tab, setTab] = useState<"config" | "credentials">(configSchema ? "config" : "credentials");
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [credsValues, setCredsValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (!open || !plugin) return;
    setLoaded(false);
    setTopError(null);
    setSaving(false);
    setSubmitAttempted(false);
    setTab(configSchema ? "config" : "credentials");
    if (configSchema) setConfigValues(defaultsFromSchema(configSchema));
    if (credsSchema) setCredsValues(defaultsFromSchema(credsSchema));
    void (async () => {
      try {
        const [configRes, credsRes] = await Promise.all([
          configSchema
            ? api.plugins[":id"]["global-config"].$get({
                param: { id: plugin.id },
              })
            : null,
          credsSchema
            ? api.plugins[":id"]["shared-credentials"].$get({
                param: { id: plugin.id },
              })
            : null,
        ]);
        if (configRes) {
          if (!configRes.ok) throw new Error("Failed to load config.");
          const body = (await configRes.json()) as { config: unknown };
          if (body.config && typeof body.config === "object") {
            setConfigValues({
              ...defaultsFromSchema(configSchema!),
              ...(body.config as Record<string, unknown>),
            });
          }
        }
        if (credsRes) {
          if (!credsRes.ok) throw new Error("Failed to load shared credentials.");
          const body = (await credsRes.json()) as { credentials: unknown };
          if (body.credentials && typeof body.credentials === "object") {
            setCredsValues({
              ...defaultsFromSchema(credsSchema!),
              ...(body.credentials as Record<string, unknown>),
            });
          }
        }
      } catch (err) {
        setTopError(err instanceof Error ? err.message : "Failed to load configuration.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [open, plugin?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plugin || (!configSchema && !credsSchema)) return null;

  const onSave = async () => {
    const activeSchema = tab === "config" ? configSchema : credsSchema;
    const activeValues = tab === "config" ? configValues : credsValues;
    if (!activeSchema) return;
    const errors = validateSchema(activeSchema, activeValues);
    if (Object.keys(errors).length > 0) {
      setSubmitAttempted(true);
      return;
    }
    setSaving(true);
    setTopError(null);
    try {
      const submission = stripEmptySecrets(activeSchema, activeValues);
      if (tab === "config") {
        const res = await api.plugins[":id"]["global-config"].$put({
          param: { id: plugin.id },
          json: { config: submission },
        });
        if (!res.ok) throw new Error("Failed to save config.");
      } else {
        const res = await api.plugins[":id"]["shared-credentials"].$put({
          param: { id: plugin.id },
          json: { credentials: submission },
        });
        if (!res.ok) throw new Error("Failed to save shared credentials.");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const activeSchema = tab === "config" ? configSchema : credsSchema;
  const activeValues = tab === "config" ? configValues : credsValues;
  const setActiveValues = tab === "config" ? setConfigValues : setCredsValues;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="gap-0 p-0 sm:max-w-120">
        <DialogHeader className="border-b border-border px-6 pt-5 pb-4">
          <DialogTitle>Configure {plugin.manifest.name}</DialogTitle>
          <DialogDescription>
            Admin-level configuration for this plugin. Secret fields stay encrypted on the server
            and are never displayed after save.
          </DialogDescription>
        </DialogHeader>
        {hasBoth ? (
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as "config" | "credentials");
              setSubmitAttempted(false);
              setTopError(null);
            }}
          >
            <TabsList className="mx-6 mt-5 w-auto">
              <TabsTrigger value="config">Global config</TabsTrigger>
              <TabsTrigger value="credentials">Shared credentials</TabsTrigger>
            </TabsList>
            <TabsContent value="config" className="mt-0">
              <ConfigFormBody
                schema={configSchema!}
                values={configValues}
                onChange={setConfigValues}
                loaded={loaded}
                topError={tab === "config" ? topError : null}
                submitAttempted={submitAttempted}
              />
            </TabsContent>
            <TabsContent value="credentials" className="mt-0">
              <ConfigFormBody
                schema={credsSchema!}
                values={credsValues}
                onChange={setCredsValues}
                loaded={loaded}
                topError={tab === "credentials" ? topError : null}
                submitAttempted={submitAttempted}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <ConfigFormBody
            schema={activeSchema!}
            values={activeValues}
            onChange={setActiveValues}
            loaded={loaded}
            topError={topError}
            submitAttempted={submitAttempted}
          />
        )}
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || !loaded}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigFormBody({
  schema,
  values,
  onChange,
  loaded,
  topError,
  submitAttempted,
}: {
  schema: JSONSchema;
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  loaded: boolean;
  topError: string | null;
  submitAttempted: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {!loaded ? (
        <Skeleton className="h-24" />
      ) : (
        <SchemaForm
          schema={schema}
          value={values}
          onChange={onChange}
          mode="edit"
          submitAttempted={submitAttempted}
        />
      )}
      {topError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
          <span>{topError}</span>
        </div>
      ) : null}
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
