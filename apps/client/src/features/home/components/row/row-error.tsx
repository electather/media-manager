import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

interface RowErrorProps {
  error: Error;
  onRetry: () => void;
  isRetrying: boolean;
}

/**
 * Full-row fallback shown when `useHomeRow` errors before any items arrive.
 * Stays inline below the row header so siblings keep rendering — a row
 * failure must not bubble to the page-level `HomeErrorBoundary`.
 */
export function RowError({ error, onRetry, isRetrying }: RowErrorProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="row-error"
      data-error-name={error.name}
      className="row-error-bg my-1 flex min-h-33 items-center gap-4 rounded-2xl border border-border px-5 py-5"
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/15 text-destructive">
        <CircleAlertIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">{m.home_row_error_message()}</p>
        <p className="max-w-[56ch] text-xs leading-relaxed text-muted-foreground">
          {m.home_row_error_body()}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
        className="shrink-0"
      >
        <RotateCcwIcon className="size-3.5" aria-hidden="true" />
        {m.home_row_error_retry()}
      </Button>
    </div>
  );
}

interface RowErrorInlineCardProps {
  error: Error;
  onRetry: () => void;
  isRetrying: boolean;
}

/**
 * Trailing pagination error rendered as the last item in the row's track when
 * `useHomeRow.fetchNextPage` rejected after at least one page already loaded.
 * Sized to one card slot via `--card-w` / `--card-h` so the row's height stays
 * stable while the user has the option to retry just the failed page.
 */
export function RowErrorInlineCard({ error, onRetry, isRetrying }: RowErrorInlineCardProps) {
  return (
    <li
      role="alert"
      aria-live="polite"
      data-testid="row-error-inline"
      data-error-name={error.name}
      className="row-error-bg flex h-(--card-h) w-(--card-w) shrink-0 flex-col items-start justify-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-4"
    >
      <div className="mb-1 flex size-8 items-center justify-center rounded-md bg-destructive/15 text-destructive">
        <CircleAlertIcon className="size-4" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-foreground">
        {m.home_row_error_pagination_message()}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {m.home_row_error_pagination_body()}
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry} disabled={isRetrying} className="mt-auto">
        <RotateCcwIcon className="size-3" aria-hidden="true" />
        {m.home_row_error_retry()}
      </Button>
    </li>
  );
}
