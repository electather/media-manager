import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { WatchlistApiError } from "../lib/types";

interface WatchlistErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
}

export function WatchlistErrorFallback({ error, resetErrorBoundary }: WatchlistErrorFallbackProps) {
  const message =
    error instanceof WatchlistApiError
      ? (error.body?.message ?? error.body?.devMessage ?? error.message)
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <h2 className="text-lg font-semibold">{m.watchlist_load_error_title()}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button size="sm" onClick={resetErrorBoundary}>
        {m.watchlist_load_error_retry()}
      </Button>
    </div>
  );
}
