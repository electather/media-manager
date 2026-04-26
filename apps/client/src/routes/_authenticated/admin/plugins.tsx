import { useEffect, useState } from "react";
import type { InferResponseType } from "hono/client";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  ChevronDownIcon,
  CogIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
  XIcon,
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
import { CapabilityBadges, type CapabilityEntry } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { JSONSchema } from "@ent-mcp/shared";
import {
  PLUGIN_ADMIN_ALLOWLIST_MAX,
  PLUGIN_ADMIN_HEADERS_MAX,
  PLUGIN_RESERVED_HEADER_NAMES,
} from "@ent-mcp/shared/plugins";
import {
  SchemaForm,
  defaultsFromSchema,
  stripEmptySecrets,
  validateSchema,
} from "@/components/connections/schema-form";
import { PersonalKeyFallbackControl } from "@/components/admin/personal-key-fallback-control";
import { SharedCredentialsSection } from "@/components/admin/shared-credentials/section";
import { safeJson } from "@/lib/errors/safe-json";

export const Route = createFileRoute("/_authenticated/admin/plugins")({
  component: AdminPluginsPage,
});

type PluginRow = InferResponseType<typeof api.plugins.$get>["plugins"][number];

type ModalState =
  | { kind: "none" }
  | { kind: "global-config"; plugin: PluginRow }
  | { kind: "uninstall"; plugin: PluginRow }
  | { kind: "install-stub" };

function AdminPluginsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const plugins = useQuery({
    queryKey: ["admin", "plugins"],
    queryFn: async () => {
      const res = await api.plugins.$get();
      if (!res.ok) throw new Error("Failed to load plugins.");
      const body = await res.json();
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
            Manage plugins that provide external service integrations. Toggle individual plugins,
            edit shared credentials inline, and uninstall third-party plugins.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setModal({ kind: "install-stub" })}>
          <PlusIcon /> Install plugin
        </Button>
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
              onConfigureGlobal={() => setModal({ kind: "global-config", plugin })}
              onUninstall={() => setModal({ kind: "uninstall", plugin })}
              onRefetch={refetch}
            />
          ))}
        </div>
      )}

      <GlobalConfigDialog
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
      <InstallStubDialog
        open={modal.kind === "install-stub"}
        onOpenChange={(open) => {
          if (!open) setModal({ kind: "none" });
        }}
      />
    </div>
  );
}

// ─── Plugin card ─────────────────────────────────────────────────────────────

interface PluginCardProps {
  plugin: PluginRow;
  onConfigureGlobal: () => void;
  onUninstall: () => void;
  onRefetch: () => void;
}

function PluginCard({ plugin, onConfigureGlobal, onUninstall, onRefetch }: PluginCardProps) {
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

  const userScoped: CapabilityEntry[] = plugin.capabilities
    .filter((c) => c.scope === "user")
    .map((c) => ({ id: c.id, version: c.version }));
  const globalScoped: CapabilityEntry[] = plugin.capabilities
    .filter((c) => c.scope === "global")
    .map((c) => ({ id: c.id, version: c.version }));
  const hasGlobalConfigSchema = Boolean(plugin.manifest.globalConfigSchema);
  const sharedSchema = (plugin.manifest.sharedCredentialsSchema ?? null) as JSONSchema | null;
  const hasSharedCredentialsSchema = sharedSchema !== null;
  const disabled = !plugin.enabled;

  const hasUserScoped = userScoped.length > 0;
  const hasGlobalScoped = globalScoped.length > 0;
  const showPoolMeta = hasSharedCredentialsSchema && plugin.sharedCredentialsCount > 0;
  // The dropdown body only ever holds "Configure global config" and "Uninstall".
  // Built-ins without a global config schema (Trakt) would render an empty
  // popover, so suppress the trigger entirely in that case.
  const hasMenuItems = hasGlobalConfigSchema || !plugin.isBuiltin;
  const capabilityHint: "global-only" | "user-fallback" | "global-and-fallback" = hasGlobalScoped
    ? hasUserScoped
      ? "global-and-fallback"
      : "global-only"
    : "user-fallback";

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
            {hasMenuItems ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More actions"
                  className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <MoreHorizontalIcon className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {hasGlobalConfigSchema ? (
                    <DropdownMenuItem onClick={onConfigureGlobal}>
                      <CogIcon /> Configure global config
                    </DropdownMenuItem>
                  ) : null}
                  {hasGlobalConfigSchema && !plugin.isBuiltin ? <DropdownMenuSeparator /> : null}
                  {!plugin.isBuiltin ? (
                    <DropdownMenuItem variant="destructive" onClick={onUninstall}>
                      <TrashIcon /> Uninstall
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {plugin.manifest.description ? (
          <p className="text-sm text-muted-foreground">{plugin.manifest.description}</p>
        ) : null}

        {hasGlobalScoped || hasUserScoped ? (
          <div className="flex flex-col gap-1.5 text-xs">
            {hasGlobalScoped ? (
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="font-medium text-muted-foreground">
                  Global:
                </span>
                <span className="sr-only">Global capabilities:</span>
                <CapabilityBadges entries={globalScoped} size="sm" />
              </div>
            ) : null}
            {hasUserScoped ? (
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="font-medium text-muted-foreground">
                  User:
                </span>
                <span className="sr-only">User-scoped capabilities:</span>
                <CapabilityBadges entries={userScoped} size="sm" />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Auth: <span className="font-medium text-foreground">{plugin.manifest.auth.kind}</span>
          </span>
          {hasGlobalConfigSchema ? (
            <span>
              Global config:{" "}
              <span className="font-medium text-foreground">
                {plugin.hasGlobalConfig ? "set" : "not set"}
              </span>
            </span>
          ) : null}
          <span>Installed {formatDate(plugin.installedAt)}</span>
          {showPoolMeta ? (
            <span>
              Pool:{" "}
              <span className="font-medium text-foreground">
                {plugin.sharedCredentialsEnabledCount}/{plugin.sharedCredentialsCount} enabled
              </span>
            </span>
          ) : null}
        </div>

        {sharedSchema ? (
          <SharedCredentialsSection
            pluginId={plugin.id}
            pluginName={plugin.manifest.name}
            schema={sharedSchema}
            poolable={plugin.poolable}
            capabilityHint={capabilityHint}
            onChanged={onRefetch}
          />
        ) : null}

        {/* The fallback policy is only meaningful when admin shared
            credentials can substitute for user credentials on a capability
            call. Under the current manifest schema that means
            `auth.kind: "none"` plugins — equivalent to `isPureGlobal` —
            where shared creds (e.g. a TMDB API key) directly satisfy every
            call. For OAuth plugins like Trakt, `sharedCredentialsSchema`
            holds the OAuth app config, which the runtime cannot feed to a
            user-scoped capability handler in place of the user's tokens, so
            surfacing the policy there would suggest an option that breaks
            the call. Pure-global plugins still render the control disabled
            with a tooltip so the affordance documents the concept. */}
        {hasSharedCredentialsSchema && plugin.isPureGlobal ? (
          <PersonalKeyFallbackControl
            pluginId={plugin.id}
            policy={plugin.personalKeyFallback}
            isPureGlobal={plugin.isPureGlobal}
            onChanged={onRefetch}
          />
        ) : null}

        <AdvancedSection plugin={plugin} onChanged={onRefetch} />
      </CardContent>
    </Card>
  );
}

// ─── Global-config dialog (single-purpose) ───────────────────────────────────

function GlobalConfigDialog({
  state,
  onOpenChange,
  onSaved,
}: {
  state: ModalState;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const open = state.kind === "global-config";
  const plugin = state.kind === "global-config" ? state.plugin : null;
  const schema = (plugin?.manifest.globalConfigSchema ?? null) as JSONSchema | null;

  if (!plugin || !schema) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-140">
        <DialogHeader className="border-b border-border px-6 pt-5 pb-4">
          <DialogTitle>Configure {plugin.manifest.name}</DialogTitle>
          <DialogDescription>
            Plaintext admin-level configuration. Secret fields stay encrypted on the server and are
            never displayed after save.
          </DialogDescription>
        </DialogHeader>
        <GlobalConfigBody
          plugin={plugin}
          schema={schema}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function GlobalConfigBody({
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

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

// ─── Install stub dialog ─────────────────────────────────────────────────────

function InstallStubDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install plugin</DialogTitle>
          <DialogDescription>
            Built-in plugins register on boot. Installing third-party plugins from a URL will ship
            in a later version.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      const res = await api.plugins[":id"].$delete({ param: { id: plugin.id } });
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

// ─── Advanced section (admin policy) ──────────────────────────────────────────

const ADMIN_HOST_PATTERN =
  /^(?:\*|(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/;
const ADMIN_HEADER_NAME_PATTERN = /^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/;

interface AdvancedSectionProps {
  plugin: PluginRow;
  onChanged: () => void;
}

function AdvancedSection({ plugin, onChanged }: AdvancedSectionProps) {
  const restrictedCount = plugin.advanced.adminAllowlist?.length ?? 0;
  const headerCount = plugin.advanced.adminHeaderNames.length;
  const hasPolicy = plugin.advanced.adminAllowlist !== null || headerCount > 0;

  return (
    <Collapsible className="border-t border-border pt-3">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
        <ChevronDownIcon className="size-3 transition-transform group-data-[panel-open]:rotate-180" />
        <span>Advanced</span>
        {hasPolicy ? (
          <Badge variant="outline" className="text-xs font-normal">
            {plugin.advanced.adminAllowlist !== null
              ? `${restrictedCount} host${restrictedCount === 1 ? "" : "s"}`
              : null}
            {plugin.advanced.adminAllowlist !== null && headerCount > 0 ? " · " : null}
            {headerCount > 0 ? `${headerCount} header${headerCount === 1 ? "" : "s"}` : null}
          </Badge>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 flex flex-col gap-5">
        <AllowlistPanel plugin={plugin} onChanged={onChanged} />
        <HeadersPanel plugin={plugin} onChanged={onChanged} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function AllowlistPanel({ plugin, onChanged }: AdvancedSectionProps) {
  const manifestHosts = plugin.manifest.allowedHosts ?? [];
  const stored = plugin.advanced.adminAllowlist;
  const [mode, setMode] = useState<"inherit" | "restrict">(
    stored === null ? "inherit" : "restrict",
  );
  const [entries, setEntries] = useState<string[]>(stored ?? []);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setMode(stored === null ? "inherit" : "restrict");
    setEntries(stored ?? []);
  }, [stored]);

  const addEntry = () => {
    const normalized = draft.trim().toLowerCase();
    if (!normalized) return;
    if (!ADMIN_HOST_PATTERN.test(normalized)) {
      setDraftError('Must be "*", a hostname, or "*.domain"');
      return;
    }
    if (entries.includes(normalized)) {
      setDraftError("Already in list");
      return;
    }
    if (entries.length >= PLUGIN_ADMIN_ALLOWLIST_MAX) {
      setDraftError(`At most ${PLUGIN_ADMIN_ALLOWLIST_MAX} entries`);
      return;
    }
    setEntries([...entries, normalized]);
    setDraft("");
    setDraftError(null);
  };

  // Mirrors the server's `isHostAllowed` pattern overlap so the banner surfaces
  // whenever the static intersection is empty — per the advanced-admin design
  // doc. Walks all four wildcard combinations between admin and manifest entries.
  const intersectionEmpty =
    mode === "restrict" &&
    (entries.length === 0 ||
      (manifestHosts.length > 0 &&
        !entries.some((a) => manifestHosts.some((m) => patternsOverlap(a, m)))));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = { allowlist: mode === "inherit" ? null : entries };
      const res = await api.plugins[":id"]["admin-allowlist"].$put({
        param: { id: plugin.id },
        json: body,
      });
      if (!res.ok) {
        const payload = (await safeJson(res)) as { devMessage?: string } | null;
        throw new Error(payload?.devMessage ?? "Failed to save allowlist.");
      }
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save allowlist.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-sm font-medium">Host allowlist override</h4>
        <p className="text-xs text-muted-foreground">
          Narrows the plugin's declared hosts. User-supplied server URLs (x-allowed-host) are never
          affected.
        </p>
      </div>
      {manifestHosts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Manifest allowlist</span>
          <div className="flex flex-wrap gap-1.5">
            {manifestHosts.map((h) => (
              <Badge key={h} variant="secondary" className="text-xs font-normal">
                {h}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name={`mode-${plugin.id}`}
            checked={mode === "inherit"}
            onChange={() => setMode("inherit")}
          />
          Inherit manifest (default)
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="radio"
            name={`mode-${plugin.id}`}
            checked={mode === "restrict"}
            onChange={() => setMode("restrict")}
            className="mt-1"
          />
          <span className="flex-1">Restrict to:</span>
        </label>
      </div>
      {mode === "restrict" ? (
        <div className="ml-5 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {entries.map((entry) => (
              <Badge key={entry} variant="outline" className="gap-1 pr-1 text-xs font-normal">
                {entry}
                <button
                  type="button"
                  aria-label={`Remove ${entry}`}
                  onClick={() => setEntries(entries.filter((e) => e !== entry))}
                  className="inline-flex size-3.5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
            {entries.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No hosts — plugin will make no static-allowlist calls.
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="api.trakt.tv or *.tmdb.org"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addEntry();
                }
              }}
              className="h-8 max-w-xs text-xs"
            />
            <Button type="button" size="sm" variant="outline" onClick={addEntry}>
              <PlusIcon /> Add
            </Button>
          </div>
          {draftError ? <p className="text-xs text-destructive">{draftError}</p> : null}
          {intersectionEmpty ? (
            <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-500">
              <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
              Plugin will make no network calls with this configuration. User-supplied server URLs
              (x-allowed-host) are unaffected.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          Save allowlist
        </Button>
        {saveError ? <span className="text-xs text-destructive">{saveError}</span> : null}
      </div>
    </div>
  );
}

function HeadersPanel({ plugin, onChanged }: AdvancedSectionProps) {
  const [dialog, setDialog] = useState<
    { kind: "none" } | { kind: "add" } | { kind: "edit"; name: string }
  >({ kind: "none" });
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteHeader = async (name: string) => {
    setDeleteError(null);
    try {
      const res = await api.plugins[":id"]["admin-headers"].$put({
        param: { id: plugin.id },
        json: { headers: { [name]: null } },
      });
      if (!res.ok) {
        const payload = (await safeJson(res)) as { devMessage?: string } | null;
        throw new Error(payload?.devMessage ?? "Failed to delete header.");
      }
      onChanged();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete header.");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-sm font-medium">Custom headers</h4>
        <p className="text-xs text-muted-foreground">
          Injected into every request this plugin makes. Admin values override plugin-supplied
          headers on conflict. Values are encrypted on the server and never returned.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        {plugin.advanced.adminHeaderNames.length === 0 ? (
          <span className="text-xs text-muted-foreground">No custom headers configured.</span>
        ) : (
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Name</th>
                <th className="py-1 font-normal">Value</th>
                <th className="w-20 py-1" />
              </tr>
            </thead>
            <tbody>
              {plugin.advanced.adminHeaderNames.map((name) => (
                <tr key={name} className="border-t border-border">
                  <td className="py-1.5 font-mono">{name}</td>
                  <td className="py-1.5 text-muted-foreground">••••</td>
                  <td className="py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ kind: "edit", name })}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteHeader(name)}
                      aria-label={`Delete ${name}`}
                    >
                      <XIcon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog({ kind: "add" })}
          disabled={plugin.advanced.adminHeaderNames.length >= PLUGIN_ADMIN_HEADERS_MAX}
        >
          <PlusIcon /> Add header
        </Button>
        {deleteError ? <span className="text-xs text-destructive">{deleteError}</span> : null}
      </div>
      <HeaderDialog
        plugin={plugin}
        state={dialog}
        onClose={() => setDialog({ kind: "none" })}
        onSaved={() => {
          setDialog({ kind: "none" });
          onChanged();
        }}
      />
    </div>
  );
}

interface HeaderDialogProps {
  plugin: PluginRow;
  state: { kind: "none" } | { kind: "add" } | { kind: "edit"; name: string };
  onClose: () => void;
  onSaved: () => void;
}

function HeaderDialog({ plugin, state, onClose, onSaved }: HeaderDialogProps) {
  const open = state.kind !== "none";
  const isEdit = state.kind === "edit";
  const initialName = state.kind === "edit" ? state.name : "";

  const [name, setName] = useState(initialName);
  const [value, setValue] = useState("");
  const [preserveValue, setPreserveValue] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setValue("");
    setPreserveValue(isEdit);
    setError(null);
  }, [open, initialName, isEdit]);

  const save = async () => {
    setError(null);
    if (!ADMIN_HEADER_NAME_PATTERN.test(name)) {
      setError("Invalid header name — use RFC 7230 token characters only.");
      return;
    }
    if ((PLUGIN_RESERVED_HEADER_NAMES as readonly string[]).includes(name.toLowerCase())) {
      setError("Header is reserved by the runtime.");
      return;
    }
    if (!preserveValue) {
      if (!value) {
        setError("Value cannot be empty — use the delete action to remove.");
        return;
      }
      if (/[\r\n]/.test(value)) {
        setError("Value contains CR/LF.");
        return;
      }
    }
    if (isEdit && preserveValue) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const res = await api.plugins[":id"]["admin-headers"].$put({
        param: { id: plugin.id },
        json: { headers: { [name]: value } },
      });
      if (!res.ok) {
        const payload = (await safeJson(res)) as { devMessage?: string } | null;
        throw new Error(payload?.devMessage ?? "Failed to save header.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save header.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit header ${name}` : "Add header"}</DialogTitle>
          <DialogDescription>
            Values are stored encrypted on the server and never displayed after save.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldTitle>Name</FieldTitle>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={isEdit}
              placeholder="X-Corp-Key"
            />
            {isEdit ? (
              <FieldDescription>To rename a header, delete and re-add it.</FieldDescription>
            ) : null}
          </Field>
          {isEdit ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={preserveValue}
                onChange={(e) => setPreserveValue(e.target.checked)}
              />
              Preserve existing value
            </label>
          ) : null}
          {!preserveValue ? (
            <Field>
              <FieldTitle>Value</FieldTitle>
              <Input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
              />
            </Field>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

// Mirrors `isHostAllowed` semantics on pairs of patterns so the advanced-admin
// allowlist UI can detect an empty intersection. Two patterns overlap if any
// hostname matches both — `*` matches everything, `*.X` matches subdomains of
// X, and exact hosts only match themselves.
function patternsOverlap(a: string, b: string): boolean {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA === "*" || lowerB === "*") return true;
  if (lowerA === lowerB) return true;
  const aWild = lowerA.startsWith("*.");
  const bWild = lowerB.startsWith("*.");
  if (aWild && !bWild) {
    const suffix = lowerA.slice(1);
    return lowerB.endsWith(suffix) && lowerB.length > suffix.length;
  }
  if (bWild && !aWild) {
    const suffix = lowerB.slice(1);
    return lowerA.endsWith(suffix) && lowerA.length > suffix.length;
  }
  if (aWild && bWild) {
    const aSuffix = lowerA.slice(1);
    const bSuffix = lowerB.slice(1);
    return aSuffix.endsWith(bSuffix) || bSuffix.endsWith(aSuffix);
  }
  return false;
}
