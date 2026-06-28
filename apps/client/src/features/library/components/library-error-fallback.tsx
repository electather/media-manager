import { useQueryClient } from "@tanstack/react-query";
import type { LibraryLens } from "@nama/shared/library";
import * as m from "@/paraglide/messages";
import { MediaApiError } from "@/shared/media/error";
import { Button } from "@/shared/ui/button";
import { LibraryApiError } from "../lib/types";
import { lensResetKey } from "../lib/fetchers";
import { libraryKeys } from "../lib/query-keys";

interface LibraryErrorFallbackProps {
  /**
   * The item lens whose route owns this fallback, scoping the retry's media
   * reset. Omitted by the layout + collections routes — they read only this
   * feature's own endpoints (`libraryKeys.all`), no media source.
   */
  lens?: Exclude<LibraryLens, "collections">;
  /**
   * The thrown error. Only its typed `status` is read to pick localized copy;
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
// 403 excluded: errors_unauthorized_body says "session ended" — wrong for a
// valid-session forbidden. Falls through to errors_default_body below.
const STATUS_BODY: Record<number, () => string> = {
  401: m.errors_unauthorized_body,
  404: m.errors_not_found_body,
  429: m.errors_rate_limited_body,
  503: m.errors_maintenance_body,
};

// fallow-ignore-next-line complexity
function resolveErrorBody(error: unknown): string {
  // Lens routes throw MediaApiError (via defineMediaSource); collection/facet
  // routes throw LibraryApiError. Both carry a typed status — handle both.
  const status =
    error instanceof LibraryApiError || error instanceof MediaApiError ? error.status : null;
  if (status === null) return m.errors_default_body();
  const exact = STATUS_BODY[status];
  if (exact) return exact();
  // Any other 5xx is a generic server fault; below that, unknown to the user.
  return status >= 500 ? m.errors_server_body() : m.errors_default_body();
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
export function LibraryErrorFallback({
  lens,
  error,
  resetErrorBoundary,
}: LibraryErrorFallbackProps) {
  const queryClient = useQueryClient();

  function handleRetry() {
    // `resetQueries` synchronously marks the cache stale (its returned refetch
    // is fire-and-forget); the boundary can clear right away and the re-mounted
    // Suspense child suspends on the fresh fetch. Don't await it — that would
    // make retry block on the refetch completing. `libraryKeys.all` covers
    // collections + facets (this feature's own endpoints). The four item lenses
    // don't key through here — they ride the shared media source under
    // `mediaKeys`, so reset just THIS lens's source rather than nuking all of
    // media, scoping the retry to the queries this route actually displays.
    void queryClient.resetQueries({ queryKey: libraryKeys.all });
    if (lens) {
      void queryClient.resetQueries({ queryKey: lensResetKey(lens) });
    }
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
