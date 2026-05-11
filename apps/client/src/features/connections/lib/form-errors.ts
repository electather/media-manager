import { m } from "@/paraglide/messages";
import {
  parseFormErrorResponse,
  splitFormError,
  type FormErrorBody,
  type FormErrorResult,
} from "@/shared/lib/diagnostics/form-errors";

/**
 * Specialised copy for the typed `plugin.credentials_empty` error from the
 * connection-modal flow: substitutes the offending field's schema title
 * (so "apiKey" surfaces as "API Key") and routes it to both the top-of-form
 * banner and the input. Returns null when the body is unrelated, letting
 * the generic `splitFormError` handle the rest.
 */
function rewriteCredentialsEmpty(
  body: FormErrorBody | null,
  schemaFieldNames: ReadonlyArray<string>,
  schemaProperties: Record<string, Record<string, unknown> | undefined>,
): FormErrorResult | null {
  if (!body || body.code !== "plugin.credentials_empty") return null;
  const field = typeof body.params?.field === "string" ? body.params.field : null;
  if (!field || !schemaFieldNames.includes(field)) return null;
  const fieldTitle = readFieldTitle(schemaProperties, field);
  // The template is `"Enter a {field.title}"`; for titles that start with a
  // vowel sound (e.g. "API Key") the literal "a" is incorrect. First-character
  // vowel detection covers the common case here without dragging in a full
  // a/an library — every current plugin's title fits it.
  const message = /^[aeiou]/i.test(fieldTitle)
    ? m.settings_connections_modal_error_credentials_empty_an({ field: fieldTitle })
    : m.settings_connections_modal_error_credentials_empty_a({ field: fieldTitle });
  return { message, fieldErrors: { [field]: message } };
}

/**
 * Routes a form error body into the modal's banner + field-error state.
 * Applies the typed `plugin.credentials_empty` rewrite first, then falls
 * back to the generic field/banner splitter.
 */
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

/**
 * Extracts a human-readable message from an error response, delegating to
 * `parseFormErrorResponse` so all error-body parsing shares a single
 * implementation. The empty `knownFields` array opts the caller out of
 * field routing — it always wants a single banner message.
 */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const routed = await parseFormErrorResponse(res, [], fallback);
  return routed.message ?? fallback;
}

/**
 * Reads a Response's JSON body without throwing on malformed payloads. Used
 * for the form-save path where we need the raw body to inspect `code` for
 * typed-error rewriting before falling back to the generic splitter.
 */
export async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Looks up the JSON-Schema `title` for a field so the typed-error rewrite
 * can substitute it into the user-facing copy. Falls back to the property
 * name (already a useful string for plugin-authored ids).
 */
export function readFieldTitle(
  properties: Record<string, Record<string, unknown> | undefined>,
  name: string,
): string {
  const def = properties[name];
  if (def && typeof def.title === "string" && def.title.length > 0) return def.title;
  return name;
}
