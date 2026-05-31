import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { throwOnApiError } from "@/shared/lib/api/throw-on-error";

/**
 * The one client-side media error (design §B1, invariant V.CL1). The §A8 cutover
 * deleted the per-feature home + watchlist error classes, so every read/write
 * through the shared media layer surfaces the same typed envelope: `status`, the
 * parsed `body`, and the stable `code` the ErrorBoundary keys retry copy off.
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
 * The one media `throwOnError` tail. Delegates to the shared `throwOnApiError`
 * idiom so the layer carries no local copy of the read-envelope-and-throw
 * dance, binding it to `MediaApiError` (design §B1). Home's layout/details
 * fetchers and the season-availability read share this tail post-cutover.
 */
export async function throwOnError(res: Response): Promise<never> {
  return throwOnApiError(res, MediaApiError);
}
