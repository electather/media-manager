/**
 * Helpers for form surfaces that receive a UserFacingError-style error from
 * the backend and need to split it into per-field errors vs a top-level
 * banner message.
 *
 * See docs/2026-04-19-error-management-design.md §Wire format for the
 * underlying contract. The `params.field` convention used here — "if the
 * error body names a form property, route the error to that input" — is the
 * project's established way to attach a backend-originated message to a
 * specific form field without needing bespoke error shapes per route.
 */

/**
 * Loose shape covering the two error-bearing wire formats the backend
 * produces today:
 *  - HttpError JSON responses (`code` / `devMessage` / `params`, per the
 *    error design doc).
 *  - Service endpoints that surface a non-HttpError failure alongside a 2xx
 *    response (e.g. `/verify-config` returning
 *    `{ ok: false, message, field? }`).
 *
 * All fields are optional because a single parser handles both shapes.
 */
export interface FormErrorBody {
  code?: string;
  devMessage?: string;
  /** Direct message surfaced by non-HttpError endpoints. */
  message?: string;
  /** Alternate envelope key some legacy handlers use for the top-level message. */
  error?: string;
  /** Direct field hint surfaced alongside `message` on non-HttpError endpoints. */
  field?: string;
  /** Interpolation values (and routing hints like `field`) per the error design doc. */
  params?: Record<string, string | number>;
  requestId?: string;
}

export interface FormErrorResult {
  /** Top-level banner message. Null when the error was routed to a field. */
  message: string | null;
  /** Per-field errors keyed by the form property name. */
  fieldErrors: Record<string, string>;
}

/**
 * Splits a parsed error body into per-field errors vs a top-level message.
 * When the body names a field that matches one of `knownFields`, the error
 * routes to that field; otherwise it falls back to the top-level banner.
 *
 * Pure function — all I/O lives in `parseFormErrorResponse`.
 */
export function splitFormError(
  body: FormErrorBody | null,
  knownFields: readonly string[],
  fallbackMessage: string,
): FormErrorResult {
  const message = readMessage(body) ?? fallbackMessage;
  const field = readField(body);
  if (field && knownFields.includes(field)) {
    return { message: null, fieldErrors: { [field]: message } };
  }
  return { message, fieldErrors: {} };
}

/**
 * Reads a Response's error body and splits it via `splitFormError`. Falls
 * back to `fallbackMessage` when the body is absent or not JSON.
 */
export async function parseFormErrorResponse(
  res: Response,
  knownFields: readonly string[],
  fallbackMessage: string,
): Promise<FormErrorResult> {
  const body = await readJsonBody(res);
  return splitFormError(body, knownFields, fallbackMessage);
}

async function readJsonBody(res: Response): Promise<FormErrorBody | null> {
  try {
    return (await res.json()) as FormErrorBody;
  } catch {
    return null;
  }
}

// Prefers the inner `params.message` over the outer `devMessage`, which is
// typically wrapped by the HTTP boundary into "auth failed: ...". Falls back
// to generic envelope keys for endpoints that don't go through HttpError.
// fallow-ignore-next-line complexity
function readMessage(body: FormErrorBody | null): string | null {
  if (!body) return null;
  const inner = typeof body.params?.message === "string" ? body.params.message : null;
  return inner ?? body.devMessage ?? body.message ?? body.error ?? null;
}

// Accepts the field hint from either `params.field` (HttpError wire format)
// or a top-level `field` (direct service-response shape).
// fallow-ignore-next-line complexity
function readField(body: FormErrorBody | null): string | null {
  if (!body) return null;
  const paramsField = typeof body.params?.field === "string" ? body.params.field : null;
  return paramsField ?? body.field ?? null;
}
