import { useQueryClient } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { mediaKeys } from "@/shared/media/query-keys";
import { Button } from "@/shared/ui/button";
import { LibraryApiError } from "../lib/types";
import { libraryKeys } from "../lib/query-keys";

interface LibraryErrorFallbackProps {
  /**
   * The thrown error. Only its typed `status` is read, to pick localized copy;
   * its raw `message` / `devMessage` is never rendered — that defaults to the
   * server-shipped English diagnostic (see body note below). A `LibraryApiError`
   * already reports at the fetch layer (`shared/lib/api.ts`).
   */
  error: unknown;
  resetErrorBoundary: () => void;
}

/**
 * Localized body for the fallback, keyed off the typed `LibraryApiError.status`
 * (never `message` / `devMessage` — those default to the server-shipped English
 * diagnostic, meaningless to a non-English user and a leak of internal detail).
 * Reuses the shared `errors_*_body` copy; unknown errors get the generic body.
 */
const STATUS_BODY: Record<number, () => string> = {
  401: m.errors_unauthorized_body,
  403: m.errors_unauthorized_body,
  404: m.errors_not_found_body,
  429: m.errors_rate_limited_body,
  503: m.errors_maintenance_body,
};

function resolveErrorBody(error: unknown): string {
  if (!(error instanceof LibraryApiError)) return m.errors_default_body();
  const exact = STATUS_BODY[error.status];
  if (exact) return exact();
  // Any other 5xx is a generic server fault; below that, unknown to the user.
  return error.status >= 500 ? m.errors_server_body() : m.errors_default_body();
}

/**
 * Shared fallback for the `/library/*` routes. Body is a localized string chosen
 * from the typed error's `status` (see `resolveErrorBody`), never the error's
 * raw `message` / `devMessage`.
 *
 * Retry resets the library queries before clearing the boundary: resetting only
 * the boundary leaves the failed query cached, so the next mount re-throws the
 * same error and retry appears to do nothing.
 */
export function LibraryErrorFallback({ error, resetErrorBoundary }: LibraryErrorFallbackProps) {
  const queryClient = useQueryClient();

  function handleRetry() {
    // `resetQueries` synchronously marks the cache stale (its returned refetch
    // is fire-and-forget); the boundary can clear right away and the re-mounted
    // Suspense child suspends on the fresh fetch. Don't await it — that would
    // make retry block on the refetch completing. The library renders two query
    // families: its own collections + facets (`libraryKeys.all`) and the four
    // item lenses, which ride the shared media source under `mediaKeys`. Reset
    // both so a failed lens read actually refetches, not just collections.
    void queryClient.resetQueries({ queryKey: libraryKeys.all });
    void queryClient.resetQueries({ queryKey: mediaKeys.root });
    resetErrorBoundary();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h2 className="text-lg font-semibold">{m.library_load_error_title()}</h2>
      <p className="text-sm text-muted-foreground">{resolveErrorBody(error)}</p>
      <Button size="sm" onClick={handleRetry}>
        {m.library_load_error_retry()}
      </Button>
    </div>
  );
}
