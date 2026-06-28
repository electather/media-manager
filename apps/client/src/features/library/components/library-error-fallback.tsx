import { useQueryClient } from "@tanstack/react-query";
import type { LibraryLens } from "@nama/shared/library";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
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
   * The thrown error, accepted to satisfy the `ErrorComponentProps` passthrough
   * from `LibraryRouteError`. Intentionally not rendered or reported here: a
   * `LibraryApiError` already reports at the fetch layer (`shared/lib/api.ts`),
   * and its raw `message` / `devMessage` must never reach the UI — see the body
   * note below.
   */
  error: unknown;
  resetErrorBoundary: () => void;
}

/**
 * Shared fallback for the `/library/*` routes. The body is a generic localized
 * string, never the error's `message` / `devMessage`: for a `LibraryApiError`
 * the message defaults to the server-shipped English diagnostic, which is
 * meaningless to a non-English user and can leak internal detail into the UI.
 *
 * Retry resets the library queries before clearing the boundary: resetting only
 * the boundary leaves the failed query cached, so the next mount re-throws the
 * same error and retry appears to do nothing.
 */
export function LibraryErrorFallback({ lens, resetErrorBoundary }: LibraryErrorFallbackProps) {
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
      <p className="text-sm text-muted-foreground">{m.errors_default_body()}</p>
      <Button size="sm" onClick={handleRetry}>
        {m.library_load_error_retry()}
      </Button>
    </div>
  );
}
