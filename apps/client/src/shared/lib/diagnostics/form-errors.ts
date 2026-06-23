/**
 * Helpers to split UserFacingError from backend into per-field errors vs top-level banner.
 * See docs/2026-04-19-error-management-design.md §Wire format. The `params.field` convention
 * routes backend messages to form inputs without bespoke per-route error shapes.
 */

/**
 * Wire formats: HttpError JSON (`code`/`devMessage`/`params`) or service-2xx
 * (`message`/`field` keys). All fields optional so one parser handles both.
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
 * Routes error to a field if `params.field` matches `knownFields`, else top-level banner.
 * Pure function — all I/O in `parseFormErrorResponse`.
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
