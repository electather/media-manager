import { useQueryClient } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { libraryKeys } from "../lib/query-keys";

interface LibraryErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
}

/**
 * Shared fallback for the `/library/*` routes. Retry resets the library queries
 * before clearing the boundary: resetting only the boundary leaves the failed
 * query cached, so the next mount re-throws the same error and retry appears to
 * do nothing.
 */
export function LibraryErrorFallback({ error, resetErrorBoundary }: LibraryErrorFallbackProps) {
  const queryClient = useQueryClient();
  const message = error instanceof Error ? error.message : String(error);

  function handleRetry() {
    // `resetQueries` synchronously marks the cache stale (its returned refetch
    // is fire-and-forget); the boundary can clear right away and the re-mounted
    // Suspense child suspends on the fresh fetch. Don't await it — that would
    // make retry block on the refetch completing.
    void queryClient.resetQueries({ queryKey: libraryKeys.all });
    resetErrorBoundary();
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h2 className="text-lg font-semibold">{m.library_load_error_title()}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button size="sm" onClick={handleRetry}>
        {m.library_load_error_retry()}
      </Button>
    </div>
  );
}
