// fallow-ignore-file unused-file
// fallow-ignore-file code-duplication
// Reason: this layer lands before its consumers — it is wired into the home /
// watchlist shells in US-008 / US-009 — and supersedes HomeApiError /
// WatchlistApiError, which are deleted at the US-013 cutover.
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { throwOnApiError } from "@/shared/lib/api/throw-on-error";

/**
 * The one client-side media error (design §B1, invariant V.CL1). It replaces the
 * per-feature `HomeApiError` + `WatchlistApiError`, so every read/write through
 * the shared media layer surfaces the same typed envelope: `status`, the parsed
 * `body`, and the stable `code` the ErrorBoundary keys retry copy off.
 */
export class MediaApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  // The message-fallback chain mirrors the HomeApiError / WatchlistApiError this class replaces.
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
 * dance, binding it to `MediaApiError` (design §B1).
 */
export async function throwOnError(res: Response): Promise<never> {
  return throwOnApiError(res, MediaApiError);
}
