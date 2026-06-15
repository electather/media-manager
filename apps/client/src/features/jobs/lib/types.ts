import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/** Typed error class for jobs API calls. Carries status, body, and code.
 *
 * Resolves the user-facing `message` from the wire body the same way the
 * `media`/`library` API errors do: `body.message`, then `body.devMessage`
 * (which is where the HttpError middleware ships the reason for job triggers),
 * then a generic fallback. Consumers can toast `err.message` directly.
 */
export class JobsApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("JobsApiError", status, body, body?.devMessage ?? `jobs request failed (${status})`);
  }
}

/**
 * Primitive value stored per form field. Using a union instead of `any` lets
 * TypeScript catch the number-coercion and required-check bugs at compile time.
 */
export type FormFieldValue = string | number | boolean | null;

/** Extension fields that the jobs dynamic-form renderer adds to a JSON Schema property. */
export interface JSONSchemaPropertyExtensions {
  /** Signals a picker widget: "user" renders UserPicker, "connection" renders ConnectionPicker. */
  "x-picker"?: "user" | "connection";
  /** Map of enum value → human label, keyed by string representation of the enum value. */
  "x-enum-labels"?: Record<string, string>;
}

/** A single property within a job's inputSchema, typed for use in the dynamic form. */
export type JSONSchemaProperty = {
  type?: string;
  enum?: unknown[];
  description?: string;
} & JSONSchemaPropertyExtensions;
