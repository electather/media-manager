import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

/**
 * Message resolved from: body.message → body.devMessage
 * (HttpError middleware reason) → generic fallback. Toast-safe.
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
