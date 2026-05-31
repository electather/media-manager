import { useQueryClient } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { MediaApiError } from "@/shared/media/error";
import { watchlistKeys } from "../lib/query-keys";

interface WatchlistErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
  /**
   * Query key the retry button should reset. Pass the most specific key
   * for the failed section so retry refetches only that section instead of
   * resuspending the whole curated page. Defaults to the watchlist root
   * key as a safety net for callers that haven't been wired up yet.
   */
  queryKey?: readonly unknown[];
}

// The message-extraction fallback chain (MediaApiError → Error → String) drives the branch count; covered by the error-fallback tests.
// fallow-ignore-next-line complexity
export function WatchlistErrorFallback({
  error,
  resetErrorBoundary,
  queryKey = watchlistKeys.root,
}: WatchlistErrorFallbackProps) {
  const queryClient = useQueryClient();
  const message =
    error instanceof MediaApiError
      ? (error.body?.message ?? error.body?.devMessage ?? error.message)
      : error instanceof Error
        ? error.message
        : String(error);
  // Resetting only the boundary leaves the failed query in the cache, so
  // the next mount immediately re-throws the same error — the retry button
  // appears to do nothing. Resetting the matching queries clears that
  // cached failure first so Suspense can refetch.
  function handleRetry() {
    void queryClient.resetQueries({ queryKey });
    resetErrorBoundary();
  }
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h2 className="text-lg font-semibold">{m.watchlist_load_error_title()}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button size="sm" onClick={handleRetry}>
        {m.watchlist_load_error_retry()}
      </Button>
    </div>
  );
}
