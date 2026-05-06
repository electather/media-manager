import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { api } from "@/shared/lib/api";
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
import type { JobHandle } from "@ent-mcp/shared/jobs";

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-xs last:border-0">
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

interface EnumOption {
  value: string;
  label: string;
}

function readEnumOptions(schema: any): EnumOption[] | null {
  if (!Array.isArray(schema?.enum) || schema.enum.length === 0) return null;
  const labels = schema["x-enum-labels"];
  return schema.enum.map((v: unknown) => {
    const value = String(v);
    const label =
      labels && typeof labels === "object" && labels !== null && value in labels
        ? String((labels as Record<string, unknown>)[value])
        : value;
    return { value, label };
  });
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

interface FieldItemProps {
  fieldKey: string;
  schema: any;
  value: any;
  required: boolean;
  invalid: boolean;
  onChange: (v: any) => void;
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
        <UserPicker value={value} onChange={onChange} />
      ) : schema["x-picker"] === "connection" ? (
        <ConnectionPicker value={value} onChange={onChange} />
      ) : enumOptions ? (
        <Select value={value ?? ""} onValueChange={(v) => onChange(v)}>
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
          type={schema.type === "number" ? "number" : "text"}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={errorId}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {invalid && <FieldError id={errorId}>This field is required</FieldError>}
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
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
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

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.jobs[":id"].trigger.$post({
        param: { id: job!.id },
        json: Object.keys(formData).length > 0 ? formData : null,
      });
      if (!res.ok) throw new Error("trigger failed");
      return res.json() as Promise<{ runId?: string }>;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
      if (data && "runId" in data && data.runId) {
        setRunId(data.runId);
      } else {
        onClose();
      }
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missingFields.length > 0) {
      setShowErrors(true);
      return;
    }
    triggerMutation.mutate();
  };

  const hasResult = !!runId;
  const properties = job?.inputSchema?.properties || {};
  const hasForm = Object.keys(properties).length > 0;
  const canSubmit = !triggerMutation.isPending && missingFields.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{hasResult ? "Job started" : "Run job"}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{job?.id}</DialogDescription>
        </DialogHeader>

        {hasResult ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <CircleCheckIcon className="size-4 shrink-0 text-emerald-500" />
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Job dispatched successfully.
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border text-xs">
              <MetaRow label="Run ID" value={runId!} mono />
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
                      value={formData[key]}
                      required={required.includes(key)}
                      invalid={showErrors && required.includes(key) && isMissing(formData[key])}
                      onChange={(v) => setFormData({ ...formData, [key]: v })}
                    />
                  ))}
                </FieldGroup>
              ) : (
                <div className="text-sm text-muted-foreground">
                  This will immediately start a new run of{" "}
                  <span className="font-mono text-foreground">{job?.id}</span>, bypassing its
                  schedule.
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={triggerMutation.isPending} aria-disabled={!canSubmit}>
                {triggerMutation.isPending ? (
                  <>
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-3.5" />
                    Run now
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}

        {hasResult && (
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
