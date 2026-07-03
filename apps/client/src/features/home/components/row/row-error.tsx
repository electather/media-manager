import { RotateCcwIcon } from "lucide-react";
import * as m from "@/paraglide/messages";
import {
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateMedia,
  ErrorStateTitle,
} from "@/shared/components/error-state";
import { Button } from "@/shared/ui/button";

interface RowErrorProps {
  error: Error;
  onRetry: () => void;
  isRetrying: boolean;
}

/**
 * Full-row fallback shown when the row's lazy read errors before any items arrive.
 * Stays inline below the row header so siblings keep rendering — a row
 * failure must not bubble to the page-level `HomeErrorBoundary`.
 */
export function RowError({ error, onRetry, isRetrying }: RowErrorProps) {
  return (
    <ErrorState data-testid="row-error" data-error-name={error.name} className="my-1">
      <ErrorStateMedia />
      <ErrorStateContent>
        <ErrorStateTitle>{m.home_row_error_message()}</ErrorStateTitle>
        <ErrorStateDescription>{m.home_row_error_body()}</ErrorStateDescription>
      </ErrorStateContent>
      <ErrorStateActions>
        <Button variant="ghost" size="sm" onClick={onRetry} disabled={isRetrying}>
          <RotateCcwIcon className="size-3.5" aria-hidden="true" />
          {m.home_row_error_retry()}
        </Button>
      </ErrorStateActions>
    </ErrorState>
  );
}
