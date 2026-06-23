import { m } from "@/paraglide/messages";
import {
  parseFormErrorResponse,
  splitFormError,
  type FormErrorBody,
  type FormErrorResult,
} from "@/shared/lib/diagnostics/form-errors";

// Rewrites plugin.credentials_empty with schema field title substitution (e.g. "apiKey" → "API Key")
// for both banner and field-level errors; returns null to delegate to splitFormError.
function rewriteCredentialsEmpty(
  body: FormErrorBody | null,
  schemaFieldNames: ReadonlyArray<string>,
  schemaProperties: Record<string, Record<string, unknown> | undefined>,
): FormErrorResult | null {
  if (!isCredentialsEmptyError(body)) return null;
  const field = readFieldParam(body);
  if (!field || !schemaFieldNames.includes(field)) return null;
  const message = formatCredentialsEmptyMessage(readFieldTitle(schemaProperties, field));
  return { message, fieldErrors: { [field]: message } };
}

function isCredentialsEmptyError(body: FormErrorBody | null): body is FormErrorBody {
  return body !== null && body.code === "plugin.credentials_empty";
}

function readFieldParam(body: FormErrorBody): string | null {
  const field = body.params?.field;
  return typeof field === "string" ? field : null;
}

// The template is `"Enter a {field.title}"`; for titles that start with a
// vowel sound (e.g. "API Key") the literal "a" is incorrect. First-character
// vowel detection covers the common case without a full a/an library.
function formatCredentialsEmptyMessage(fieldTitle: string): string {
  return /^[aeiou]/i.test(fieldTitle)
    ? m.settings_connections_modal_error_credentials_empty_an({ field: fieldTitle })
    : m.settings_connections_modal_error_credentials_empty_a({ field: fieldTitle });
}

// Applies credentials_empty rewrite first, then falls back to generic splitter.
export function routeFormError(
  body: FormErrorBody | null,
  schemaFieldNames: ReadonlyArray<string>,
  schemaProperties: Record<string, Record<string, unknown> | undefined>,
  fallback: string,
): FormErrorResult {
  return (
    rewriteCredentialsEmpty(body, schemaFieldNames, schemaProperties) ??
    splitFormError(body, schemaFieldNames, fallback)
  );
}

// Extracts banner-only message via parseFormErrorResponse (empty knownFields skips field routing).
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const routed = await parseFormErrorResponse(res, [], fallback);
  return routed.message ?? fallback;
}

// Silent JSON parse — used to inspect error body code before generic fallback.
export async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Looks up JSON-Schema title for field substitution in error text; falls back to field name.
export function readFieldTitle(
  properties: Record<string, Record<string, unknown> | undefined>,
  name: string,
): string {
  const def = properties[name];
  if (def && typeof def.title === "string" && def.title.length > 0) return def.title;
  return name;
}
