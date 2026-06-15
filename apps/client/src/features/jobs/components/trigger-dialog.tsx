import { useEffect, useMemo, useState } from "react";
import { isNil } from "es-toolkit/predicate";
import { CircleCheckIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { FieldGroup, Field, FieldLabel, FieldContent, FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { UserPicker, ConnectionPicker } from "@/shared/components/pickers";
import type { JobHandle } from "@nama/shared/jobs";
import { useTriggerJob } from "../hooks/use-trigger-job";
import { MetaRow } from "./meta-row";
import type { FormFieldValue, JSONSchemaProperty } from "../lib/types";

interface EnumOption {
  value: string;
  label: string;
}

function isMissing(value: unknown): boolean {
  return isNil(value) || value === "";
}

function readEnumOptions(schema: JSONSchemaProperty): EnumOption[] | null {
  if (!Array.isArray(schema?.enum) || schema.enum.length === 0) return null;
  const labels = schema["x-enum-labels"];
  return schema.enum.map((v: unknown) => {
    const value = String(v);
    const label =
      labels && typeof labels === "object" && value in labels ? String(labels[value]) : value;
    return { value, label };
  });
}

interface FieldItemProps {
  fieldKey: string;
  schema: JSONSchemaProperty;
  value: FormFieldValue;
  required: boolean;
  invalid: boolean;
  onChange: (v: FormFieldValue) => void;
}

/** JSON Schema numeric types whose form input is coerced to a `number`. */
const NUMERIC_SCHEMA_TYPES = ["number", "integer"];

function isNumericSchema(schema: JSONSchemaProperty): boolean {
  return schema.type != null && NUMERIC_SCHEMA_TYPES.includes(schema.type);
}

/** Coerces a raw input value to the appropriate type for a schema field.
 *
 * Numeric fields (`number` and `integer`) receive a numeric conversion so the
 * POSTed payload matches the server's JSON-schema type declaration rather than
 * sending a string the server-side AJV validator would reject.
 */
function coerceValue(schema: JSONSchemaProperty, raw: string): FormFieldValue {
  if (isNumericSchema(schema)) {
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  return raw;
}

// fallow-ignore-next-line complexity
function FieldItem({ fieldKey, schema, value, required, invalid, onChange }: FieldItemProps) {
  const enumOptions = readEnumOptions(schema);
  const labelText = fieldKey.replace(/([A-Z])/g, " $1").trim();
  const errorId = invalid ? `${fieldKey}-error` : undefined;
  return (
    <Field key={fieldKey} data-invalid={invalid || undefined}>
      <FieldContent>
        <FieldLabel htmlFor={fieldKey} className="capitalize">
          {labelText}
          {required && (
            <span aria-hidden="true" className="ml-1 text-destructive">
              *
            </span>
          )}
        </FieldLabel>
      </FieldContent>
      {schema["x-picker"] === "user" ? (
        <UserPicker value={value as string} onChange={onChange} />
      ) : schema["x-picker"] === "connection" ? (
        <ConnectionPicker value={value as string} onChange={onChange} />
      ) : enumOptions ? (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger
            id={fieldKey}
            aria-invalid={invalid || undefined}
            aria-describedby={errorId}
          >
            <SelectValue placeholder={schema.description ?? "Select…"}>
              {(v) =>
                enumOptions.find((opt) => opt.value === v)?.label ??
                (typeof v === "string" ? v : "")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {enumOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={fieldKey}
          type={isNumericSchema(schema) ? "number" : "text"}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={errorId}
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(coerceValue(schema, e.target.value))}
        />
      )}
      {invalid && (
        <FieldError id={errorId}>{m.admin_jobs_trigger_field_required_error()}</FieldError>
      )}
    </Field>
  );
}

// fallow-ignore-next-line complexity
export function DynamicTriggerDialog({
  open,
  job,
  onClose,
}: {
  open: boolean;
  job: JobHandle | null;
  onClose: () => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, FormFieldValue>>({});
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) {
      setRunId(null);
      setFormData({});
      setShowErrors(false);
    }
  }, [open]);

  const required = useMemo<string[]>(() => {
    const r = job?.inputSchema?.required;
    return Array.isArray(r) ? (r as string[]) : [];
  }, [job?.inputSchema?.required]);

  const missingFields = useMemo(
    () => required.filter((key) => isMissing(formData[key])),
    [required, formData],
  );

  const triggerMutation = useTriggerJob();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missingFields.length > 0) {
      setShowErrors(true);
      return;
    }
    triggerMutation.mutate(
      {
        jobId: job!.id,
        input: Object.keys(formData).length > 0 ? formData : null,
      },
      {
        onSuccess: (data) => {
          if (data && "runId" in data && data.runId) {
            setRunId(data.runId);
          } else {
            onClose();
          }
        },
      },
    );
  };

  const hasResult = !!runId;
  const properties = (job?.inputSchema?.properties as Record<string, JSONSchemaProperty>) ?? {};
  const hasForm = Object.keys(properties).length > 0;
  const canSubmit = !triggerMutation.isPending && missingFields.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {hasResult
              ? m.admin_jobs_trigger_dialog_title_result()
              : m.admin_jobs_trigger_dialog_title_run()}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{job?.id}</DialogDescription>
        </DialogHeader>

        {hasResult ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                {m.admin_jobs_trigger_dialog_dispatched()}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border text-xs">
              <MetaRow label={m.admin_jobs_run_detail_meta_run_id()} value={runId!} mono />
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="contents">
            <div className="py-2">
              {hasForm ? (
                <FieldGroup className="gap-4">
                  {Object.entries(properties).map(([key, schema]) => (
                    <FieldItem
                      key={key}
                      fieldKey={key}
                      schema={schema}
                      value={formData[key] ?? null}
                      required={required.includes(key)}
                      invalid={showErrors && required.includes(key) && isMissing(formData[key])}
                      onChange={(v) => setFormData({ ...formData, [key]: v })}
                    />
                  ))}
                </FieldGroup>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {m.admin_jobs_trigger_dialog_schedule_bypass({ jobId: job?.id ?? "" })}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                {m.admin_jobs_trigger_dialog_cancel()}
              </Button>
              <Button type="submit" disabled={triggerMutation.isPending} aria-disabled={!canSubmit}>
                {triggerMutation.isPending ? (
                  <>
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                    {m.admin_jobs_trigger_dialog_starting()}
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-3.5" />
                    {m.admin_jobs_trigger_dialog_run_now()}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {hasResult && (
          <DialogFooter>
            <Button onClick={onClose}>{m.admin_jobs_trigger_dialog_done()}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
