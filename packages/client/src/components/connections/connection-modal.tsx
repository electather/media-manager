import { useEffect, useState } from "react";
import {
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { capabilityDisplay } from "@/lib/capabilities";
import { api } from "@/lib/api";
import {
  parseFormErrorResponse,
  splitFormError,
  type FormErrorResult,
} from "@/lib/errors/form-errors";

import type { JSONSchema } from "@ent-mcp/shared";
import { SchemaForm, defaultsFromSchema, stripEmptySecrets, validateSchema } from "./schema-form";

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  auth: string;
  capabilities: string[];
  userConfigSchema?: JSONSchema | null;
  hasSharedConfig?: boolean;
}

export interface ExistingConnection {
  id: string;
  displayName: string | null;
  userConfig: unknown;
}

interface Props {
  open: boolean;
  plugin: PluginSummary | null;
  existing?: ExistingConnection | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type TestState = { kind: "idle" } | { kind: "testing" } | { kind: "ok" } | { kind: "err" };

type DeviceState =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "waiting";
      userCode: string;
      verifyUrl: string;
      nonce: string;
      intervalSec: number;
      expiresAt: number;
    }
  | { kind: "err"; message: string };

export function ConnectionModal({ open, plugin, existing, onOpenChange, onSuccess }: Props) {
  const isEdit = Boolean(existing);
  const authKind = plugin?.auth ?? "none";
  const userConfigSchema = (plugin?.userConfigSchema ?? null) as JSONSchema | null;
  const hasUserConfigFields =
    userConfigSchema !== null &&
    typeof userConfigSchema === "object" &&
    Object.keys((userConfigSchema.properties ?? {}) as Record<string, unknown>).length > 0;

  const [displayName, setDisplayName] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName(existing?.displayName ?? "");
    setServerErrors({});
    setTest({ kind: "idle" });
    setSaving(false);
    setTopError(null);
    setDevice({ kind: "idle" });
    setSubmitAttempted(false);
    if (authKind === "form" && userConfigSchema) {
      const base = defaultsFromSchema(userConfigSchema);
      if (isEdit && existing?.userConfig && typeof existing.userConfig === "object") {
        setValues({ ...base, ...(existing.userConfig as Record<string, unknown>) });
      } else {
        setValues(base);
      }
    } else {
      setValues({});
    }
  }, [open, authKind, userConfigSchema, isEdit, existing?.displayName, existing?.userConfig]);

  // Countdown tick for the device code panel.
  useEffect(() => {
    if (device.kind !== "waiting") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [device.kind]);

  // Poll the device auth endpoint while the device panel is live.
  useEffect(() => {
    if (device.kind !== "waiting") return;
    const { nonce, intervalSec } = device;
    let cancelled = false;
    const id = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await api.connections.oauth.device.poll.$post({ json: { nonce } });
        const body = (await res.json()) as
          | { status: "pending" }
          | { status: "completed"; connectionId: string }
          | { status: "error"; message: string };
        if (cancelled) return;
        if (body.status === "completed") {
          onSuccess();
          onOpenChange(false);
        } else if (body.status === "error") {
          setDevice({ kind: "err", message: body.message });
        }
      } catch (err) {
        if (cancelled) return;
        setDevice({ kind: "err", message: err instanceof Error ? err.message : "Polling failed." });
      }
    }, intervalSec * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [device, onOpenChange, onSuccess]);

  if (!plugin) return null;

  const title = `${isEdit ? "Edit" : "Add"} ${plugin.name} Connection`;

  const canInteract = !saving && device.kind !== "starting" && device.kind !== "waiting";
  const handleOpenChange = (next: boolean) => {
    if (!canInteract && !next) return;
    onOpenChange(next);
  };

  const schemaFieldNames = Object.keys(
    (userConfigSchema?.properties ?? {}) as Record<string, unknown>,
  );

  // Applies a routed error to the modal's state: field-scoped messages go to
  // `serverErrors` (which the SchemaForm already renders under the matching
  // input), and the top-level message lights up the banner. `submitAttempted`
  // is flipped on so the SchemaForm actually surfaces a fresh server error
  // even before the user touches the field.
  const applyFormError = (routed: FormErrorResult) => {
    setServerErrors(routed.fieldErrors);
    setTopError(routed.message);
    if (Object.keys(routed.fieldErrors).length > 0) setSubmitAttempted(true);
  };

  const clearPendingErrors = () => {
    setServerErrors({});
    setTopError(null);
  };

  const runTest = async () => {
    if (!plugin) return;
    clearPendingErrors();
    if (userConfigSchema) {
      const clientErrors = validateSchema(userConfigSchema, values);
      if (Object.keys(clientErrors).length > 0) {
        setSubmitAttempted(true);
        setTest({ kind: "err" });
        setTopError("Fix the highlighted fields before testing.");
        return;
      }
    }
    setTest({ kind: "testing" });
    try {
      const res = await api.connections["verify-config"].$post({
        json: { pluginId: plugin.id, userConfig: values },
      });
      const body = (await res.json()) as {
        ok: boolean;
        message?: string;
        field?: string;
        params?: Record<string, string | number>;
      };
      if (body.ok) {
        setTest({ kind: "ok" });
      } else {
        setTest({ kind: "err" });
        applyFormError(splitFormError(body, schemaFieldNames, "Test failed."));
      }
    } catch (err) {
      setTest({ kind: "err" });
      setTopError(err instanceof Error ? err.message : "Test failed.");
    }
  };

  const handleSaveForm = async () => {
    if (!plugin || !userConfigSchema) return;
    const errors = validateSchema(userConfigSchema, values);
    if (Object.keys(errors).length > 0) {
      setSubmitAttempted(true);
      return;
    }
    setSaving(true);
    clearPendingErrors();
    try {
      const submission = isEdit ? stripEmptySecrets(userConfigSchema, values) : values;
      const fallback = isEdit ? "Failed to update connection." : "Failed to create connection.";
      const res =
        isEdit && existing
          ? await patchExistingConnection(existing.id, submission)
          : await createNewConnection(submission);
      if (!res.ok) {
        applyFormError(await parseFormErrorResponse(res, schemaFieldNames, fallback));
        return;
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  // Patches display name then user-config on an existing connection and
  // returns the user-config response so the caller can route its errors.
  // Display-name update is fire-and-forget by shape — no error routing on it
  // to keep the field-level error path tied to a single response.
  const patchExistingConnection = async (
    connectionId: string,
    submission: Record<string, unknown>,
  ): Promise<Response> => {
    await api.connections[":id"]["display-name"].$patch({
      param: { id: connectionId },
      json: { displayName: displayName || plugin.name },
    });
    return api.connections[":id"]["user-config"].$patch({
      param: { id: connectionId },
      json: { userConfig: submission },
    });
  };

  const createNewConnection = (submission: Record<string, unknown>): Promise<Response> =>
    api.connections.$post({
      json: {
        pluginId: plugin.id,
        userConfig: submission,
        displayName: displayName || undefined,
      },
    });

  const handleSaveOauthEdit = async () => {
    if (!plugin || !existing) return;
    setSaving(true);
    setTopError(null);
    try {
      await api.connections[":id"]["display-name"].$patch({
        param: { id: existing.id },
        json: { displayName: displayName || plugin.name },
      });
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const handleStartDevice = async () => {
    if (!plugin) return;
    setDevice({ kind: "starting" });
    try {
      const res = await api.connections.oauth.device.start.$post({
        json: { pluginId: plugin.id },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to start device auth."));
      const body = (await res.json()) as {
        userCode: string;
        verifyUrl: string;
        nonce: string;
        intervalSec: number;
        expiresAt: number;
      };
      setNow(Date.now());
      setDevice({ kind: "waiting", ...body });
    } catch (err) {
      setDevice({ kind: "err", message: err instanceof Error ? err.message : "Failed to start." });
    }
  };

  const handleStartRedirect = async () => {
    if (!plugin) return;
    setSaving(true);
    setTopError(null);
    try {
      const res = await api.connections.oauth.redirect.start.$post({
        json: { pluginId: plugin.id },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to start authorization."));
      const body = (await res.json()) as { redirectUrl: string; nonce: string };
      // Stash the nonce + plugin name so the callback route can resume the flow and show a clean
      // return-destination toast. sessionStorage is safe here — the callback runs in the same tab.
      sessionStorage.setItem(
        "connections.oauthPending",
        JSON.stringify({ nonce: body.nonce, pluginId: plugin.id, pluginName: plugin.name }),
      );
      window.location.assign(body.redirectUrl);
    } catch (err) {
      setSaving(false);
      setTopError(err instanceof Error ? err.message : "Failed to start authorization.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-120"
        showCloseButton={canInteract}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 pt-5 pb-4">
          <div className="flex items-start gap-3">
            {plugin.logoUrl ? (
              <img
                src={plugin.logoUrl}
                alt=""
                className="mt-0.5 size-5 rounded-sm object-contain"
              />
            ) : null}
            <div className="flex flex-1 flex-col gap-0.5">
              <DialogTitle className="flex items-baseline gap-2">
                {title}
                <span className="text-xs font-normal tracking-wide text-muted-foreground">
                  v{plugin.version}
                </span>
              </DialogTitle>
              {plugin.description ? (
                <DialogDescription>{plugin.description}</DialogDescription>
              ) : null}
            </div>
          </div>
          {plugin.capabilities.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {plugin.capabilities.map((cap) => {
                const { label, icon: Icon } = capabilityDisplay(cap);
                return (
                  <span
                    key={cap}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    <Icon className="size-3 opacity-60" aria-hidden="true" />
                    {label}
                  </span>
                );
              })}
            </div>
          ) : null}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <Field>
            <FieldTitle>
              Display name
              <span className="text-xs font-normal text-muted-foreground">optional</span>
            </FieldTitle>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={plugin.name}
              disabled={!canInteract}
            />
          </Field>

          {renderBody({
            authKind,
            isEdit,
            hasUserConfigFields,
            userConfigSchema,
            values,
            setValues,
            serverErrors,
            submitAttempted,
            plugin,
            device,
            now,
            onRetryDevice: () => setDevice({ kind: "idle" }),
          })}

          {topError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
              <span>{topError}</span>
            </div>
          ) : null}
        </div>

        {renderFooter({
          authKind,
          isEdit,
          hasUserConfigFields,
          test,
          saving,
          device,
          onCancel: () => onOpenChange(false),
          onTest: runTest,
          onSaveForm: handleSaveForm,
          onSaveOauthEdit: handleSaveOauthEdit,
          onStartDevice: handleStartDevice,
          onStartRedirect: handleStartRedirect,
        })}
      </DialogContent>
    </Dialog>
  );
}

interface BodyArgs {
  authKind: string;
  isEdit: boolean;
  hasUserConfigFields: boolean;
  userConfigSchema: JSONSchema | null;
  values: Record<string, unknown>;
  setValues: (next: Record<string, unknown>) => void;
  serverErrors: Record<string, string>;
  submitAttempted: boolean;
  plugin: PluginSummary;
  device: DeviceState;
  now: number;
  onRetryDevice: () => void;
}

function renderBody(args: BodyArgs) {
  const {
    authKind,
    isEdit,
    hasUserConfigFields,
    userConfigSchema,
    values,
    setValues,
    serverErrors,
    submitAttempted,
    plugin,
    device,
    now,
    onRetryDevice,
  } = args;

  if (authKind === "form") {
    if (!userConfigSchema) {
      return (
        <p className="text-sm text-muted-foreground">
          This plugin doesn't require any configuration.
        </p>
      );
    }
    return (
      <SchemaForm
        schema={userConfigSchema}
        value={values}
        onChange={setValues}
        serverErrors={serverErrors}
        mode={isEdit ? "edit" : "create"}
        submitAttempted={submitAttempted}
      />
    );
  }

  if (authKind === "oauth_device") {
    if (isEdit) return <OauthEditNotice plugin={plugin} />;
    if (device.kind === "waiting") {
      return <DeviceCodePanel device={device} now={now} />;
    }
    if (device.kind === "err") {
      return (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-5 text-sm text-destructive">
          <span>{device.message}</span>
          <div>
            <Button variant="outline" size="sm" onClick={onRetryDevice}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return (
      <OauthIntro
        plugin={plugin}
        body={`You'll get a short code to enter on ${plugin.name}. We wait here while you approve it in another tab.`}
      />
    );
  }

  if (authKind === "oauth_redirect") {
    if (isEdit) return <OauthEditNotice plugin={plugin} />;
    return (
      <OauthIntro
        plugin={plugin}
        body={`Clicking Connect redirects you to ${plugin.name} to approve access. You'll return here automatically.`}
      />
    );
  }

  if (authKind === "none") {
    if (hasUserConfigFields && userConfigSchema) {
      return (
        <SchemaForm
          schema={userConfigSchema}
          value={values}
          onChange={setValues}
          serverErrors={serverErrors}
          mode={isEdit ? "edit" : "create"}
          submitAttempted={submitAttempted}
        />
      );
    }
    return <p className="text-sm text-muted-foreground">No configuration required.</p>;
  }

  return null;
}

function OauthIntro({ plugin, body }: { plugin: PluginSummary; body: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-4 py-4 text-sm">
      <p className="text-foreground">
        <strong className="font-medium">Connect with {plugin.name}</strong>
      </p>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}

function OauthEditNotice({ plugin }: { plugin: PluginSummary }) {
  return (
    <FieldDescription>
      Credentials for {plugin.name} aren't editable here. Use <em>Reconnect</em> from the card to
      re-run authorization.
    </FieldDescription>
  );
}

function DeviceCodePanel({
  device,
  now,
}: {
  device: Extract<DeviceState, { kind: "waiting" }>;
  now: number;
}) {
  const remaining = Math.max(0, Math.floor((device.expiresAt - now) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 px-4 py-5">
      <div className="flex flex-col items-center gap-3">
        <span className="text-xs tracking-wide text-muted-foreground uppercase">Your code</span>
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-3xl tracking-[0.25em] tabular-nums"
            aria-label={`Device code: ${device.userCode}`}
          >
            {device.userCode}
          </span>
          <CopyButton value={device.userCode} label="Copy" variant="outline" size="sm" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 text-sm">
        <a
          href={device.verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          Open {new URL(device.verifyUrl).hostname}
          <ExternalLinkIcon className="size-3.5" />
        </a>
        <span className="text-xs text-muted-foreground">Enter the code there to authorize.</span>
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        <span>Waiting for approval</span>
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ClockIcon className="size-3" />
          {mm}:{ss}
        </span>
      </div>
    </div>
  );
}

interface FooterArgs {
  authKind: string;
  isEdit: boolean;
  hasUserConfigFields: boolean;
  test: TestState;
  saving: boolean;
  device: DeviceState;
  onCancel: () => void;
  onTest: () => void;
  onSaveForm: () => void;
  onSaveOauthEdit: () => void;
  onStartDevice: () => void;
  onStartRedirect: () => void;
}

function renderFooter(args: FooterArgs) {
  const {
    authKind,
    isEdit,
    test,
    saving,
    device,
    onCancel,
    onTest,
    onSaveForm,
    onSaveOauthEdit,
    onStartDevice,
    onStartRedirect,
    hasUserConfigFields,
  } = args;

  if (authKind === "form") {
    return (
      <DialogFooter className="shrink-0 flex-wrap items-center gap-2 border-t border-border px-6 py-4">
        <div className="mr-auto flex items-center gap-2 text-xs">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={test.kind === "testing" || saving}
          >
            {test.kind === "testing" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : test.kind === "ok" ? (
              <CheckIcon />
            ) : null}
            {test.kind === "testing"
              ? "Testing…"
              : test.kind === "ok"
                ? "Tested"
                : "Test connection"}
          </Button>
          {test.kind === "ok" ? (
            <span className="text-green-700 dark:text-green-400">Connection verified</span>
          ) : null}
        </div>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSaveForm} disabled={saving}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          {isEdit ? "Save changes" : "Save connection"}
        </Button>
      </DialogFooter>
    );
  }

  if (authKind === "oauth_device") {
    if (isEdit) {
      return (
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSaveOauthEdit} disabled={saving}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      );
    }
    if (device.kind === "waiting") {
      return (
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      );
    }
    const startDisabled = device.kind === "starting";
    return (
      <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
        <Button variant="outline" onClick={onCancel} disabled={startDisabled}>
          Cancel
        </Button>
        <Button onClick={onStartDevice} disabled={startDisabled}>
          {startDisabled ? <LoaderCircleIcon className="animate-spin" /> : null}
          Connect
        </Button>
      </DialogFooter>
    );
  }

  if (authKind === "oauth_redirect") {
    if (isEdit) {
      return (
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSaveOauthEdit} disabled={saving}>
            Save changes
          </Button>
        </DialogFooter>
      );
    }
    return (
      <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onStartRedirect} disabled={saving}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          Connect
        </Button>
      </DialogFooter>
    );
  }

  if (authKind === "none") {
    if (!hasUserConfigFields) {
      return (
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSaveForm} disabled={saving}>
            {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
            Connect
          </Button>
        </DialogFooter>
      );
    }
    return (
      <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSaveForm} disabled={saving}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          {isEdit ? "Save changes" : "Save connection"}
        </Button>
      </DialogFooter>
    );
  }

  return null;
}

// Extracts a human-readable message from an error response, delegating to
// `parseFormErrorResponse` so all error-body parsing shares a single
// implementation. The empty `knownFields` array opts this caller out of
// field routing — it always wants a single banner message.
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const routed = await parseFormErrorResponse(res, [], fallback);
  return routed.message ?? fallback;
}
