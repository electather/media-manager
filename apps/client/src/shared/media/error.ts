import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { throwOnApiError } from "@/shared/lib/api/throw-on-error";

/**
 * Single client-side media error (design §B1, invariant V.CL1).
 * Per-feature classes deleted in §A8 cutover; all read/write now surfaces same envelope.
 */
export class MediaApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  // Reason: the branches are the message-fallback chain (message ?? devMessage ?? default) plus the `code` type-narrowing; all are needed to build one envelope.
  // fallow-ignore-next-line complexity
  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? body?.devMessage ?? `media request failed (${status})`);
    this.name = "MediaApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

/**
 * Single media `throwOnError` tail, binding read-envelope-and-throw to `MediaApiError` (design §B1).
 * Shared by home layout/details fetchers and season-availability read post-cutover.
 */
export async function throwOnError(res: Response): Promise<never> {
  return throwOnApiError(res, MediaApiError);
}
