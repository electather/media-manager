import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { api } from "@/shared/lib/api";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/shared/ui/drawer";
import { Field, FieldTitle } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/shared/ui/sheet";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperLabel,
  StepperSeparator,
} from "@/shared/ui/stepper";
import { useInterval } from "@/shared/hooks/use-interval";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";

import type { JSONSchema } from "@nama/shared";
import {
  defaultsFromSchema,
  stripEmptySecrets,
  validateSchema,
} from "@/shared/components/schema-form";
import type { FormErrorBody, FormErrorResult } from "@/shared/lib/diagnostics/form-errors";

import { ConnectionModalBody } from "./connection-modal-body";
import { ConnectionModalDone } from "./connection-modal-done";
import { ConnectionModalFooter } from "./connection-modal-footer";
import { ConnectionModalHeader } from "./connection-modal-header";
import { readErrorBody, readErrorMessage, routeFormError } from "../lib/form-errors";
import type {
  DeviceState,
  ExistingConnection,
  PluginSummary,
  Stage,
  TestState,
} from "../lib/types";

// Re-export public types so consumers can import via `@/features/connections`.
export type { ExistingConnection, PluginSummary } from "../lib/types";

interface Props {
  open: boolean;
  plugin: PluginSummary | null;
  existing?: ExistingConnection | null;
  /**
   * Reconnect mode for a broken OAuth connection: re-runs the auth ceremony
   * (device-code / redirect) rather than the display-name-only OAuth edit form.
   * The server rebinds the fresh credentials to the existing connection, so no
   * id needs to be threaded through — the OAuth start call carries only
   * `pluginId`, and a non-poolable plugin's single row is updated in place.
   */
  reconnect?: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// fallow-ignore-next-line complexity
export function ConnectionModal({
  open,
  plugin,
  existing,
  reconnect = false,
  onOpenChange,
  onSuccess,
}: Props) {
  // Reconnect drives the create-style auth surface (auth step + stepper), not
  // the edit surface, even though it targets an existing connection.
  const isEdit = Boolean(existing) && !reconnect;
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
  const [stage, setStage] = useState<Stage>("configure");

  const isMobile = useIsMobile();

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
    setStage("configure");

    if (authKind !== "form" || !userConfigSchema) {
      setValues({});
      return;
    }

    // Always seed with schema defaults first so the form is responsive
    // while the prefill request is in flight.
    const base = defaultsFromSchema(userConfigSchema);
    setValues(base);

    // Edit-mode prefill: hydrate non-secret fields from the server's
    // `GET /api/connections/:id/user-config`. `x-secret` / `x-private`
    // fields are stripped by the endpoint so they keep their masked
    // / "leave blank to keep" placeholder behaviour.
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
  useInterval(() => setNow(Date.now()), device.kind === "waiting" ? 1000 : null);

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
          setStage("done");
          setDevice({ kind: "idle" });
        } else if (body.status === "error") {
          setDevice({ kind: "err", message: body.message });
        }
      } catch (err) {
        if (cancelled) return;
        setDevice({
          kind: "err",
          message:
            err instanceof Error
              ? err.message
              : m.settings_connections_modal_error_polling_failed(),
        });
      }
    }, intervalSec * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [device, onSuccess]);

  const schemaProperties = useMemo(
    () =>
      (userConfigSchema?.properties ?? {}) as Record<string, Record<string, unknown> | undefined>,
    [userConfigSchema],
  );

  // Property names currently rendered as inputs. In create mode, SchemaForm
  // hides `x-plugin-resolved` fields — routing a server error into one of
  // them would land the message in a hidden slot and silently disappear.
  // Exclude them so the error falls back to the top-level banner instead.
  const schemaFieldNames = useMemo(
    () =>
      Object.keys(schemaProperties).filter((name) => {
        const def = schemaProperties[name];
        const hiddenInCreate = def?.["x-plugin-resolved"] === true && !isEdit;
        return !hiddenInCreate;
      }),
    [schemaProperties, isEdit],
  );

  if (!plugin) return null;

  const canInteract = !saving && device.kind !== "starting" && device.kind !== "waiting";
  const handleOpenChange = (next: boolean) => {
    if (!canInteract && !next) return;
    onOpenChange(next);
  };

  const applyFormError = (routed: FormErrorResult) => {
    setServerErrors(routed.fieldErrors);
    setTopError(routed.message);
    if (Object.keys(routed.fieldErrors).length > 0) setSubmitAttempted(true);
  };

  const clearPendingErrors = () => {
    setServerErrors({});
    setTopError(null);
  };

  // fallow-ignore-next-line complexity
  const runTest = async () => {
    clearPendingErrors();
    if (userConfigSchema) {
      const clientErrors = validateSchema(userConfigSchema, values);
      if (Object.keys(clientErrors).length > 0) {
        setSubmitAttempted(true);
        setTest({ kind: "err" });
        setTopError(m.settings_connections_modal_error_fix_fields());
        return;
      }
    }
    setTest({ kind: "testing" });
    try {
      const res = await api.connections["verify-config"].$post({
        json: { pluginId: plugin.id, userConfig: values },
      });
      const body = (await res.json()) as FormErrorBody & { ok?: boolean };
      if (body.ok) {
        setTest({ kind: "ok" });
      } else {
        setTest({ kind: "err" });
        applyFormError(
          routeFormError(
            body,
            schemaFieldNames,
            schemaProperties,
            m.settings_connections_modal_error_test_failed(),
          ),
        );
      }
    } catch (err) {
      setTest({ kind: "err" });
      setTopError(
        err instanceof Error ? err.message : m.settings_connections_modal_error_test_failed(),
      );
    }
  };

  // fallow-ignore-next-line complexity
  const handleSaveForm = async () => {
    if (!userConfigSchema) return;
    // Wipe stale server-side errors before validation runs — otherwise an
    // earlier server error banner would persist while the user re-edits and
    // re-submits, even though the new attempt has not been to the server yet.
    clearPendingErrors();
    const errors = validateSchema(userConfigSchema, values);
    if (Object.keys(errors).length > 0) {
      setSubmitAttempted(true);
      return;
    }
    setSaving(true);
    try {
      const submission = isEdit ? stripEmptySecrets(userConfigSchema, values) : values;
      const fallback = isEdit
        ? m.settings_connections_modal_error_update_failed()
        : m.settings_connections_modal_error_create_failed();
      const res =
        isEdit && existing
          ? await patchExistingConnection(existing.id, submission)
          : await createNewConnection(submission);
      if (!res.ok) {
        const body = (await readErrorBody(res)) as FormErrorBody | null;
        applyFormError(routeFormError(body, schemaFieldNames, schemaProperties, fallback));
        return;
      }
      onSuccess();
      if (isEdit) {
        onOpenChange(false);
      } else {
        setStage("done");
      }
    } catch (err) {
      setTopError(
        err instanceof Error ? err.message : m.settings_connections_modal_error_generic(),
      );
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
    if (!existing) return;
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
      setTopError(toGenericErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // fallow-ignore-next-line complexity
  const handleStartDevice = async () => {
    setDevice({ kind: "starting" });
    try {
      const res = await api.connections.oauth.device.start.$post({
        json: { pluginId: plugin.id },
      });
      if (!res.ok)
        throw new Error(
          await readErrorMessage(res, m.settings_connections_modal_error_device_start_failed()),
        );
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
      setDevice({
        kind: "err",
        message:
          err instanceof Error
            ? err.message
            : m.settings_connections_modal_error_device_start_failed(),
      });
    }
  };

  // fallow-ignore-next-line complexity
  const handleStartRedirect = async () => {
    setSaving(true);
    setTopError(null);
    try {
      const res = await api.connections.oauth.redirect.start.$post({
        json: { pluginId: plugin.id },
      });
      if (!res.ok)
        throw new Error(
          await readErrorMessage(res, m.settings_connections_modal_error_authorize_failed()),
        );
      const body = (await res.json()) as { redirectUrl: string; nonce: string };
      // Stash the nonce + plugin name so the callback route can resume the
      // flow and show a clean return-destination toast. sessionStorage is
      // safe here — the callback runs in the same tab.
      sessionStorage.setItem(
        "connections.oauthPending",
        JSON.stringify({ nonce: body.nonce, pluginId: plugin.id, pluginName: plugin.name }),
      );
      window.location.assign(body.redirectUrl);
    } catch (err) {
      setSaving(false);
      setTopError(
        err instanceof Error ? err.message : m.settings_connections_modal_error_authorize_failed(),
      );
    }
  };

  const isOAuth = authKind === "oauth_device" || authKind === "oauth_redirect";
  const showStepper = !isEdit && stage !== "done";
  const stepperSteps: ReadonlyArray<{ id: string; label: string }> = isOAuth
    ? [
        { id: "auth", label: m.settings_connections_modal_step_authorise() },
        { id: "done", label: m.settings_connections_modal_step_done() },
      ]
    : [
        { id: "configure", label: m.settings_connections_modal_step_configure() },
        { id: "done", label: m.settings_connections_modal_step_done() },
      ];
  const currentStepIndex = stage === "done" ? 1 : 0;

  const shellTitle = isMobile ? DrawerTitle : SheetTitle;
  const shellDescription = isMobile ? DrawerDescription : SheetDescription;

  const shell: ReactNode = (
    <>
      <ConnectionModalHeader
        plugin={plugin}
        isEdit={isEdit}
        reconnect={reconnect}
        canClose={canInteract}
        onClose={() => onOpenChange(false)}
        Title={shellTitle}
        Description={shellDescription}
      />

      {showStepper ? (
        <Stepper
          current={currentStepIndex}
          aria-label={m.settings_connections_modal_stepper_aria()}
        >
          {stepperSteps.map((step, i) => (
            <Fragment key={step.id}>
              {i > 0 ? <StepperSeparator /> : null}
              <StepperItem index={i}>
                <StepperIndicator />
                <StepperLabel>{step.label}</StepperLabel>
              </StepperItem>
            </Fragment>
          ))}
        </Stepper>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
        {stage === "done" ? (
          <ConnectionModalDone plugin={plugin} />
        ) : (
          <>
            {/* Reconnect rebinds credentials to the existing row and never
                touches its display name, so the field would be misleading —
                hide it and show only the auth ceremony. */}
            {reconnect ? null : (
              <Field>
                <FieldTitle>
                  {m.settings_connections_modal_display_name()}
                  <span className="text-xs font-normal text-muted-foreground">
                    {m.settings_connections_modal_optional()}
                  </span>
                </FieldTitle>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={plugin.name}
                  disabled={!canInteract}
                />
              </Field>
            )}

            <ConnectionModalBody
              authKind={authKind}
              isEdit={isEdit}
              hasUserConfigFields={hasUserConfigFields}
              userConfigSchema={userConfigSchema}
              values={values}
              setValues={setValues}
              serverErrors={serverErrors}
              submitAttempted={submitAttempted}
              plugin={plugin}
              device={device}
              now={now}
              onRetryDevice={() => setDevice({ kind: "idle" })}
            />

            {topError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
                <span>{topError}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ConnectionModalFooter
        authKind={authKind}
        isEdit={isEdit}
        stage={stage}
        hasUserConfigFields={hasUserConfigFields}
        test={test}
        saving={saving}
        device={device}
        onCancel={() => onOpenChange(false)}
        onDone={() => onOpenChange(false)}
        onTest={runTest}
        onSaveForm={handleSaveForm}
        onSaveOauthEdit={handleSaveOauthEdit}
        onStartDevice={handleStartDevice}
        onStartRedirect={handleStartRedirect}
      />
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="flex h-[92dvh] w-full flex-col gap-0 p-0">
          <div className="flex h-full min-h-0 flex-col">{shell}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        {shell}
      </SheetContent>
    </Sheet>
  );
}

function toGenericErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : m.settings_connections_modal_error_generic();
}
