import { useEffect, useState } from "react";
import {
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { CopyButton } from "@/shared/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Field, FieldDescription, FieldTitle } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { CapabilityBadges, capabilityListSummary, type CapabilityEntry } from "@/shared/lib/capabilities";
import { api } from "@/shared/lib/api";
import {
  parseFormErrorResponse,
  splitFormError,
  type FormErrorBody,
  type FormErrorResult,
} from "@/shared/lib/errors/form-errors";

import type { JSONSchema } from "@ent-mcp/shared";
import { SchemaForm, defaultsFromSchema, stripEmptySecrets, validateSchema } from "./schema-form";

/**
 * Shape the modal needs to render the create/edit dialog. Mirrors the
 * `PluginSummary` shape returned by `/api/connections/available` and
 * embedded on connection rows — both `connections.tsx` and
 * `admin/plugins.tsx` can pass the inferred row through unchanged.
 */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  logoUrl?: string;
  authKind: "form" | "oauth_redirect" | "oauth_device" | "none";
  userScopedCapabilities: ReadonlyArray<CapabilityEntry>;
  globalScopedCapabilities: ReadonlyArray<CapabilityEntry>;
  userConfigSchema: Record<string, unknown> | null;
  adminSharedAvailable: boolean;
}

export interface ExistingConnection {
  id: string;
  displayName: string | null;
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

// fallow-ignore-next-line complexity
export function ConnectionModal({ open, plugin, existing, onOpenChange, onSuccess }: Props) {
  const isEdit = Boolean(existing);
  const authKind = plugin?.authKind ?? "none";
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

  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!open) return;
    setDisplayName(existing?.displayName ?? "");
    setServerErrors({});
    setTest({ kind: "idle" });
    setSaving(false);
    setTopError(null);
    setDevice({ kind: "idle" });
    setSubmitAttempted(false);

    if (authKind !== "form" || !userConfigSchema) {
      setValues({});
      return;
    }

    // Always seed with schema defaults first so the form is responsive
    // while the prefill request is in flight.
    const base = defaultsFromSchema(userConfigSchema);
    setValues(base);

    // Edit-mode prefill: hydrate non-secret fields from the server's
    // `GET /api/connections/:id/user-config`. Without this, opening Edit
    // would show blank inputs for values the user previously entered;
    // `x-secret` / `x-private` fields are stripped by the endpoint so
    // they keep their masked / "leave blank to keep" placeholder behaviour.
    if (!isEdit || !existing?.id) return;
    let cancelled = false;
    // fallow-ignore-next-line complexity
    void (async () => {
      try {
        const res = await api.connections[":id"]["user-config"].$get({
          param: { id: existing.id },
        });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (cancelled) return;
        if (body.config && typeof body.config === "object" && !Array.isArray(body.config)) {
          setValues({ ...base, ...(body.config as Record<string, unknown>) });
        }
      } catch {
        // Network/parse failure leaves the schema defaults in place; the
        // user can still re-enter values, and the save path will surface
        // a real error if there's a deeper issue.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, authKind, userConfigSchema, isEdit, existing?.displayName, existing?.id]);

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
    // fallow-ignore-next-line complexity
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

  // Property names currently rendered as inputs. In create mode, SchemaForm
  // hides `x-plugin-resolved` fields (the plugin owns them, the user never
  // submits one) — routing a server error into one of them would land the
  // message in a hidden slot and silently disappear. Exclude them so the
  // error falls back to the top-level banner instead.
  const schemaProperties = (userConfigSchema?.properties ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const schemaFieldNames = Object.keys(schemaProperties).filter((name) => {
    const def = schemaProperties[name];
    const hiddenInCreate = def?.["x-plugin-resolved"] === true && !isEdit;
    return !hiddenInCreate;
  });

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

  // Specialised copy for the typed `plugin.credentials_empty` error from
  // Migration step 2 of the design doc: substitutes the offending field's
  // schema title (so "apiKey" surfaces as "API Key") and routes it to both
  // the top-of-form banner and the input. Returns null when the body is
  // unrelated, letting the generic `splitFormError` handle the rest.
  // `plugin.invalid_base_url` is already routed correctly by the field
  // handler; the design doc only mandates field highlighting for it, not
  // a fixed message, so we leave the server-supplied copy in place.
  // fallow-ignore-next-line complexity
  const rewriteTypedFormError = (body: FormErrorBody | null): FormErrorResult | null => {
    if (!body || body.code !== "plugin.credentials_empty") return null;
    const field = typeof body.params?.field === "string" ? body.params.field : null;
    if (!field || !schemaFieldNames.includes(field)) return null;
    const fieldTitle = readFieldTitle(schemaProperties, field);
    // The design doc's template is `"Enter a {field.title}"`; for titles that
    // start with a vowel sound (e.g. "API Key") the literal "a" is incorrect.
    // First-character vowel detection covers the common case here without
    // dragging in a full a/an library — every current plugin's title fits it.
    const article = /^[aeiou]/i.test(fieldTitle) ? "an" : "a";
    const message = `Credentials can't be blank. Enter ${article} ${fieldTitle} to continue.`;
    return { message, fieldErrors: { [field]: message } };
  };

  const routeFormError = (body: FormErrorBody | null, fallback: string): FormErrorResult => {
    return rewriteTypedFormError(body) ?? splitFormError(body, schemaFieldNames, fallback);
  };

  const clearPendingErrors = () => {
    setServerErrors({});
    setTopError(null);
  };

  // fallow-ignore-next-line complexity
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
        applyFormError(routeFormError(body, "Test failed."));
      }
    } catch (err) {
      setTest({ kind: "err" });
      setTopError(err instanceof Error ? err.message : "Test failed.");
    }
  };

  // fallow-ignore-next-line complexity
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
        const body = (await readErrorBody(res)) as FormErrorBody | null;
        applyFormError(routeFormError(body, fallback));
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

  // fallow-ignore-next-line complexity
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

  // fallow-ignore-next-line complexity
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

  // fallow-ignore-next-line complexity
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
          {plugin.userScopedCapabilities.length > 0 ? (
            <div className="mt-2">
              <CapabilityBadges entries={plugin.userScopedCapabilities} size="sm" />
            </div>
          ) : null}
          {plugin.globalScopedCapabilities.length > 0 ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              <span className="sr-only">Also available without a connection: </span>
              Also provides {capabilityListSummary(plugin.globalScopedCapabilities)} without a
              connection
            </p>
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

// fallow-ignore-next-line complexity
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
        <div className="@container flex w-full items-center justify-center gap-3">
          <span
            className="cursor-pointer font-mono text-[clamp(1rem,7cqi,1.875rem)] tracking-[0.25em] tabular-nums wrap-anywhere select-all"
            aria-label={`Device code: ${device.userCode}`}
            onClick={(e) => {
              const range = document.createRange();
              range.selectNodeContents(e.currentTarget);
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
            }}
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

// fallow-ignore-next-line complexity
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

// Reads a Response's JSON body without throwing on malformed payloads. Used
// for the form-save path where we need the raw body to inspect `code` for
// typed-error rewriting before falling back to the generic splitter.
async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Looks up the JSON-Schema `title` for a field so the typed-error rewrite
// can substitute it into the user-facing copy. Falls back to the property
// name (already a useful string for plugin-authored ids).
function readFieldTitle(
  properties: Record<string, Record<string, unknown> | undefined>,
  name: string,
): string {
  const def = properties[name];
  if (def && typeof def.title === "string" && def.title.length > 0) return def.title;
  return name;
}
