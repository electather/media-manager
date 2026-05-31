import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
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

interface RowErrorInlineCardProps {
  error: Error;
  onRetry: () => void;
  isRetrying: boolean;
}

/**
 * Trailing pagination error rendered as the last item in the row's track when
 * the row's `fetchNextPage` rejected after at least one page already loaded.
 * Sized to one card slot via `--card-w` / `--card-h` so the row's height stays
 * stable while the user has the option to retry just the failed page.
 */
export function RowErrorInlineCard({ error, onRetry, isRetrying }: RowErrorInlineCardProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="row-error-inline"
      data-error-name={error.name}
      className="flex h-(--card-h) w-(--card-w) shrink-0 flex-col items-start justify-center gap-1.5 rounded-xl border border-dashed border-border bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_oklab,var(--destructive)_18%,transparent)_0%,transparent_55%),var(--card)] px-4 py-4"
    >
      <div className="mb-1 flex size-8 items-center justify-center rounded-md bg-destructive/15 text-destructive">
        <CircleAlertIcon className="size-4" aria-hidden="true" />
      </div>
      <ErrorStateTitle>{m.home_row_error_pagination_message()}</ErrorStateTitle>
      <ErrorStateDescription className="max-w-none">
        {m.home_row_error_pagination_body()}
      </ErrorStateDescription>
      <Button variant="ghost" size="sm" onClick={onRetry} disabled={isRetrying} className="mt-auto">
        <RotateCcwIcon className="size-3" aria-hidden="true" />
        {m.home_row_error_retry()}
      </Button>
    </div>
  );
}
