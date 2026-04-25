import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import type { InferResponseType } from "hono/client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  SchemaForm,
  defaultsFromSchema,
  stripEmptySecrets,
  validateSchema,
} from "@/components/connections/schema-form";
import { api } from "@/lib/api";
import {
  parseFormErrorResponse,
  splitFormError,
  type FormErrorBody,
  type FormErrorResult,
} from "@/lib/errors/form-errors";
import { safeJson } from "@/lib/errors/safe-json";
import { cn } from "@/lib/utils";
import type { JSONSchema } from "@ent-mcp/shared";

type SharedCredentialEntry = InferResponseType<
  (typeof api.plugins)[":id"]["shared-credentials"]["$get"]
>["entries"][number];

interface SharedCredentialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginId: string;
  pluginName: string;
  /** `manifest.sharedCredentialsSchema`. Required for the dialog to render. */
  schema: JSONSchema;
  /** When provided, dialog is in edit mode; absent → create mode. */
  existing?: SharedCredentialEntry;
  /**
   * Reports whether this save changed the meta-line counters: `true` for
   * adds and edits that flipped `enabled`; `false` for label/value-only
   * edits. Lets the section choose between local-only and pool-wide
   * invalidation per the design doc's invalidation table.
   */
  onSaved: (affectsPoolCounts: boolean) => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; message?: string }
  | { kind: "err"; message: string };

/**
 * Add / Edit shared credential dialog. The primary `Test & save` button
 * runs the **ephemeral** test endpoint (`POST /shared-credentials/test-ephemeral`)
 * against the unsaved value, then persists on `{ ok: true }`. On `{ ok: false }`
 * the dialog surfaces the error inline and promotes `Save without test` so the
 * admin can choose to proceed anyway.
 */
export function SharedCredentialDialog({
  open,
  onOpenChange,
  pluginId,
  pluginName,
  schema,
  existing,
  onSaved,
}: SharedCredentialDialogProps) {
  const isEdit = Boolean(existing);
  const [label, setLabel] = useState(existing?.label ?? "");
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultsFromSchema(schema));
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Reset on open or when editing a different entry. We don't auto-fetch
  // the existing decrypted values — the server never returns them; the
  // admin re-enters or leaves blank. Deliberately *not* depending on
  // `existing.label` / `existing.enabled` — a background refetch that
  // updates those fields shouldn't blow away in-progress edits.
  useEffect(() => {
    if (!open) return;
    setLabel(existing?.label ?? "");
    setEnabled(existing?.enabled ?? true);
    setValues(defaultsFromSchema(schema));
    setServerErrors({});
    setTopError(null);
    setLabelError(null);
    setTest({ kind: "idle" });
    setSubmitAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional, see comment above
  }, [open, existing?.id, schema]);

  const schemaProperties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const schemaFieldNames = Object.keys(schemaProperties);

  const applyFormError = (routed: FormErrorResult) => {
    setServerErrors(routed.fieldErrors);
    setTopError(routed.message);
    if (Object.keys(routed.fieldErrors).length > 0) setSubmitAttempted(true);
    if (routed.fieldErrors.label) setLabelError(routed.fieldErrors.label);
  };

  const ephemeralTest = useMutation({
    mutationFn: async () => {
      const res = await api.plugins[":id"]["shared-credentials"]["test-ephemeral"].$post({
        param: { id: pluginId },
        json: { value: stripEmptySecrets(schema, values) },
      });
      if (!res.ok) {
        const routed = await parseFormErrorResponse(res, schemaFieldNames, "Test failed.");
        return { ok: false as const, message: routed.message ?? "Test failed.", routed };
      }
      const body = (await res.json()) as { ok: boolean; message?: string };
      return body.ok
        ? { ok: true as const, message: body.message }
        : { ok: false as const, message: body.message ?? "Test failed.", routed: null };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // On edit, only send fields the admin actually changed.
      if (isEdit && existing) {
        const patch: { label?: string; value?: unknown; enabled?: boolean } = {};
        if (label.trim() !== existing.label) patch.label = label.trim();
        const hasFilledValues = Object.values(values).some((v) => v !== "" && v !== undefined);
        if (hasFilledValues) patch.value = stripEmptySecrets(schema, values);
        const enabledChanged = enabled !== existing.enabled;
        if (enabledChanged) patch.enabled = enabled;
        const res = await api.plugins[":id"]["shared-credentials"][":credId"].$patch({
          param: { id: pluginId, credId: existing.id },
          json: patch,
        });
        if (!res.ok) {
          const body = (await safeJson(res)) as FormErrorBody | null;
          return { ok: false as const, body };
        }
        return { ok: true as const, affectsPoolCounts: enabledChanged };
      }
      const res = await api.plugins[":id"]["shared-credentials"].$post({
        param: { id: pluginId },
        json: { label: label.trim(), value: stripEmptySecrets(schema, values) },
      });
      if (!res.ok) {
        const body = (await safeJson(res)) as FormErrorBody | null;
        return { ok: false as const, body };
      }
      // Adding a new credential always shifts the pool-count meta line.
      return { ok: true as const, affectsPoolCounts: true };
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(isEdit ? "Shared credential updated." : "Shared credential saved.");
        onSaved(result.affectsPoolCounts);
        onOpenChange(false);
      } else {
        applyFormError(splitFormError(result.body, schemaFieldNames, "Failed to save."));
      }
    },
    onError: (err: unknown) => {
      setTopError(err instanceof Error ? err.message : "Failed to save.");
    },
  });

  const validate = (): boolean => {
    setSubmitAttempted(true);
    setLabelError(null);
    if (label.trim() === "") {
      setLabelError("Label is required.");
      return false;
    }
    // On edit we only validate the form when the admin actually filled in
    // new values; otherwise the existing ciphertext stays.
    const hasFilledValues = Object.values(values).some((v) => v !== "" && v !== undefined);
    if (!isEdit || hasFilledValues) {
      const errs = validateSchema(schema, values);
      if (Object.keys(errs).length > 0) return false;
    }
    return true;
  };

  const onTestAndSave = async () => {
    setTopError(null);
    if (!validate()) return;
    setTest({ kind: "testing" });
    try {
      const result = await ephemeralTest.mutateAsync();
      if (!result.ok) {
        setTest({ kind: "err", message: result.message });
        if (result.routed) applyFormError(result.routed);
        return;
      }
      setTest({ kind: "ok", message: result.message });
      // Test passed — persist immediately.
      saveMutation.mutate();
    } catch (err) {
      setTest({ kind: "err", message: err instanceof Error ? err.message : "Test failed." });
    }
  };

  const onSaveWithoutTest = () => {
    setTopError(null);
    if (!validate()) return;
    saveMutation.mutate();
  };

  const onClose = () => {
    if (saveMutation.isPending || ephemeralTest.isPending) return;
    onOpenChange(false);
  };

  const testFailed = test.kind === "err";
  const testing = test.kind === "testing";
  const saving = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="gap-0 p-0 sm:max-w-130" showCloseButton={!testing && !saving}>
        <DialogHeader className="border-b border-border px-6 pt-5 pb-4">
          <DialogTitle>
            {isEdit ? "Edit shared credential" : `Add shared credential for ${pluginName}`}
          </DialogTitle>
          <DialogDescription>
            Stored encrypted on the server and never returned. Use <strong>Test &amp; save</strong>{" "}
            to verify before persisting.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 py-5">
          <Field data-invalid={labelError ? true : undefined}>
            <FieldTitle>
              Label
              <span className="text-destructive" aria-hidden="true">
                *
              </span>
            </FieldTitle>
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (labelError) setLabelError(null);
                if (serverErrors.label) {
                  const { label: _label, ...rest } = serverErrors;
                  setServerErrors(rest);
                }
              }}
              placeholder="e.g. Primary key"
              disabled={saving || testing}
              aria-invalid={labelError ? true : undefined}
            />
            {labelError ? <FieldError>{labelError}</FieldError> : null}
            {!labelError ? (
              <FieldDescription>
                A short name so you can identify this entry in the pool.
              </FieldDescription>
            ) : null}
          </Field>

          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldTitle className="m-0">Enabled</FieldTitle>
              <Switch
                checked={enabled}
                onCheckedChange={(next) => setEnabled(Boolean(next))}
                disabled={saving || testing}
                aria-label={enabled ? "Disable credential" : "Enable credential"}
              />
            </div>
            <FieldDescription>
              Disabled entries stay in the pool but are skipped during rotation.
            </FieldDescription>
          </Field>

          <SchemaForm
            schema={schema}
            value={values}
            onChange={setValues}
            mode={isEdit ? "edit" : "create"}
            serverErrors={serverErrors}
            submitAttempted={submitAttempted}
            disabled={saving || testing}
          />
          {isEdit ? (
            <p className="text-xs text-muted-foreground">
              Leave secret fields empty to keep their existing value.
            </p>
          ) : null}

          {test.kind === "ok" ? (
            <InlineBanner tone="success">
              <CheckIcon className="size-4" />
              Verified{test.message ? `: ${test.message}` : "."}
            </InlineBanner>
          ) : null}
          {testFailed ? (
            <InlineBanner tone="destructive">
              <XIcon className="size-4" />
              {test.message}
            </InlineBanner>
          ) : null}
          {topError ? (
            <InlineBanner tone="destructive">
              <TriangleAlertIcon className="size-4" />
              {topError}
            </InlineBanner>
          ) : null}
        </div>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={saving || testing}>
            Cancel
          </Button>
          {/* `Test & save` is the primary action by default. Once an
              ephemeral test has failed, `Save without test` promotes to the
              primary so the admin can persist the value despite the failure
              (per design doc § states). The two buttons swap variants —
              never both primary or both outline. */}
          <Button
            type="button"
            variant={testFailed ? "default" : "outline"}
            size="sm"
            onClick={onSaveWithoutTest}
            disabled={saving || testing}
          >
            {saving && testFailed ? <LoaderCircleIcon className="animate-spin" /> : null}
            Save without test
          </Button>
          <Button
            type="button"
            variant={testFailed ? "outline" : "default"}
            onClick={() => void onTestAndSave()}
            disabled={saving || testing}
          >
            {testing || (saving && !testFailed) ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : null}
            {testing ? "Testing…" : "Test & save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InlineBanner({
  tone,
  children,
}: {
  tone: "success" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "success" &&
          "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
        tone === "destructive" && "border-destructive/40 bg-destructive/5 text-destructive",
      )}
      role={tone === "destructive" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}
