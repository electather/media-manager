import { useMemo, useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type JSONSchema = Record<string, unknown>;

interface FieldSchema {
  name: string;
  type: "string" | "number" | "integer" | "boolean";
  title: string;
  description?: string;
  format?: string;
  secret: boolean;
  enumValues?: string[];
  defaultValue?: unknown;
  required: boolean;
  minimum?: number;
  maximum?: number;
  step?: number;
}

function parseFields(schema: JSONSchema): FieldSchema[] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required ?? []) as string[]);
  return Object.entries(properties).map(([name, raw]) => {
    const type = (raw.type as FieldSchema["type"]) ?? "string";
    const xSecret = raw["x-secret"] === true;
    const enumList = Array.isArray(raw.enum) ? (raw.enum as string[]) : undefined;
    return {
      name,
      type,
      title: typeof raw.title === "string" ? raw.title : name,
      description: typeof raw.description === "string" ? raw.description : undefined,
      format: typeof raw.format === "string" ? raw.format : undefined,
      secret: xSecret,
      enumValues: enumList,
      defaultValue: raw.default,
      required: required.has(name),
      minimum: typeof raw.minimum === "number" ? raw.minimum : undefined,
      maximum: typeof raw.maximum === "number" ? raw.maximum : undefined,
      step: typeof raw.multipleOf === "number" ? raw.multipleOf : undefined,
    };
  });
}

/** Initial form values from a schema's `default` entries. */
export function defaultsFromSchema(schema: JSONSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of parseFields(schema)) {
    if (f.defaultValue !== undefined) out[f.name] = f.defaultValue;
    else if (f.type === "boolean") out[f.name] = false;
  }
  return out;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function stringifyScalar(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function validateField(field: FieldSchema, value: unknown): string | null {
  if (field.required && isBlank(value)) return `${field.title} is required.`;
  if (isBlank(value)) return null;
  if (field.enumValues && !field.enumValues.includes(String(value))) {
    return `Must be one of: ${field.enumValues.join(", ")}.`;
  }
  if (field.type === "string" && field.format === "uri") {
    try {
      const u = new URL(String(value));
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return "Must be an http or https URL.";
      }
    } catch {
      return "Must be a valid URL.";
    }
  }
  if (field.type === "number" || field.type === "integer") {
    const n = Number(value);
    if (Number.isNaN(n)) return "Must be a number.";
    if (field.type === "integer" && !Number.isInteger(n)) return "Must be an integer.";
    if (field.minimum !== undefined && n < field.minimum)
      return `Must be at least ${field.minimum}.`;
    if (field.maximum !== undefined && n > field.maximum)
      return `Must be at most ${field.maximum}.`;
  }
  return null;
}

/** Validates all fields. Returns a map of field name → first error message. */
export function validateSchema(
  schema: JSONSchema,
  value: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of parseFields(schema)) {
    const err = validateField(field, value[field.name]);
    if (err) errors[field.name] = err;
  }
  return errors;
}

/** Strips empty secret values so an edit submission preserves the existing ciphertext. */
export function stripEmptySecrets(
  schema: JSONSchema,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...value };
  for (const field of parseFields(schema)) {
    if (field.secret && isBlank(out[field.name])) delete out[field.name];
  }
  return out;
}

interface SchemaFormProps {
  schema: JSONSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  serverErrors?: Record<string, string>;
  mode?: "create" | "edit";
  disabled?: boolean;
  submitAttempted?: boolean;
}

export function SchemaForm({
  schema,
  value,
  onChange,
  serverErrors = {},
  mode = "create",
  disabled,
  submitAttempted = false,
}: SchemaFormProps) {
  const fields = useMemo(() => parseFields(schema), [schema]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [secretShown, setSecretShown] = useState<Record<string, boolean>>({});

  const clientErrors = useMemo(() => validateSchema(schema, value), [schema, value]);

  const setValue = (name: string, next: unknown) => {
    onChange({ ...value, [name]: next });
  };

  if (fields.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        const raw = value[field.name];
        const err =
          touched[field.name] || submitAttempted
            ? (serverErrors[field.name] ?? clientErrors[field.name])
            : undefined;
        const invalid = Boolean(err);

        return (
          <Field key={field.name} data-invalid={invalid || undefined}>
            <FieldTitle>
              {field.title}
              {field.required ? (
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              ) : (
                <span className="text-xs font-normal text-muted-foreground">optional</span>
              )}
            </FieldTitle>
            {renderControl(field, raw, setValue, {
              mode,
              disabled,
              invalid,
              shown: secretShown[field.name],
              toggleShown: () => setSecretShown((s) => ({ ...s, [field.name]: !s[field.name] })),
              onBlur: () => setTouched((t) => ({ ...t, [field.name]: true })),
            })}
            {field.description && !invalid ? (
              <FieldDescription>{field.description}</FieldDescription>
            ) : null}
            {invalid ? <FieldError>{err}</FieldError> : null}
          </Field>
        );
      })}
    </div>
  );
}

interface ControlOpts {
  mode: "create" | "edit";
  disabled?: boolean;
  invalid: boolean;
  shown?: boolean;
  toggleShown: () => void;
  onBlur: () => void;
}

function renderControl(
  field: FieldSchema,
  value: unknown,
  setValue: (name: string, next: unknown) => void,
  opts: ControlOpts,
) {
  const commonInputProps = {
    "aria-invalid": opts.invalid || undefined,
    disabled: opts.disabled,
    onBlur: opts.onBlur,
  } as const;

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          checked={value === true}
          onCheckedChange={(next: boolean) => setValue(field.name, next)}
          disabled={opts.disabled}
          aria-invalid={opts.invalid || undefined}
        />
        <span className="text-sm text-muted-foreground">{field.description ?? "Enabled"}</span>
      </div>
    );
  }

  if (field.enumValues) {
    return (
      <Select
        value={stringifyScalar(value)}
        onValueChange={(next) => setValue(field.name, next ?? "")}
        disabled={opts.disabled}
      >
        <SelectTrigger className="w-full" aria-invalid={opts.invalid || undefined}>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          {field.enumValues.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.secret) {
    const editMode = opts.mode === "edit";
    return (
      <InputGroup>
        <InputGroupInput
          type={opts.shown ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={editMode ? "Leave blank to keep current value" : "••••••••••••••••"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(field.name, e.target.value)}
          {...commonInputProps}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            onClick={opts.toggleShown}
            aria-label={opts.shown ? "Hide value" : "Show value"}
            type="button"
          >
            {opts.shown ? <EyeOffIcon /> : <EyeIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  }

  if (field.type === "string" && field.format === "textarea") {
    return (
      <Textarea
        value={typeof value === "string" ? value : ""}
        onChange={(e) => setValue(field.name, e.target.value)}
        {...commonInputProps}
      />
    );
  }

  if (field.type === "number" || field.type === "integer") {
    return (
      <Input
        type="number"
        inputMode={field.type === "integer" ? "numeric" : "decimal"}
        value={stringifyScalar(value)}
        min={field.minimum}
        max={field.maximum}
        step={field.step ?? (field.type === "integer" ? 1 : undefined)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") setValue(field.name, undefined);
          else setValue(field.name, field.type === "integer" ? parseInt(v, 10) : parseFloat(v));
        }}
        {...commonInputProps}
      />
    );
  }

  const isUri = field.format === "uri";
  return (
    <Input
      type={isUri ? "url" : "text"}
      inputMode={isUri ? "url" : undefined}
      autoComplete="off"
      spellCheck={false}
      className={cn(isUri && "font-mono text-xs")}
      value={typeof value === "string" ? value : ""}
      onChange={(e) => setValue(field.name, e.target.value)}
      placeholder={isUri ? "https://example.com" : undefined}
      {...commonInputProps}
    />
  );
}

/** Returns field metadata needed to render a non-secret display list on cards. */
export function nonSecretFields(schema: JSONSchema): Array<{
  name: string;
  label: string;
  isUri: boolean;
}> {
  return parseFields(schema)
    .filter((f) => !f.secret)
    .map((f) => ({ name: f.name, label: f.title, isUri: f.format === "uri" }));
}
