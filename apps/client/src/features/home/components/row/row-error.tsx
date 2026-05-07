import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

interface RowErrorProps {
  error: Error;
  onRetry: () => void;
  isRetrying: boolean;
}

/**
 * Inline fallback for a single row when its `useHomeRow` query errors. Sits
 * inside the scroller's flex track so other rows on the page keep rendering;
 * a row failure must not bubble to the page-level `HomeErrorBoundary`.
 */
export function RowError({ error, onRetry, isRetrying }: RowErrorProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex min-h-(--card-h) flex-col items-start justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-sm"
    >
      <p className="text-foreground">{m.home_row_error_message()}</p>
      <p className="text-xs text-muted-foreground">{error.message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
        {m.home_row_error_retry()}
      </Button>
    </div>
  );
}
