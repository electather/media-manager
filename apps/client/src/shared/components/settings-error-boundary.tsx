import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";

import { ErrorBoundary } from "@/shared/components/error-boundary";
import { shortRequestId } from "@/shared/lib/diagnostics/request-id";
import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";

function SettingsErrorFallback({
  error,
  requestId,
  reset,
  resetQueryKey,
}: {
  error: Error;
  requestId: string;
  reset: () => void;
  resetQueryKey?: ReadonlyArray<unknown>;
}) {
  const queryClient = useQueryClient();
  const onRetry = () => {
    if (resetQueryKey) {
      void queryClient.resetQueries({ queryKey: resetQueryKey });
    }
    reset();
  };

  return (
    <div
      role="alert"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-8 py-10 text-center"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlertIcon className="size-5" aria-hidden="true" />
      </div>
      <h2 className="text-base font-medium text-foreground">{m.settings_error_title()}</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {error.message || m.settings_error_description()}
      </p>
      {requestId ? (
        <p className="font-mono text-xs text-muted-foreground">
          {m.settings_error_request_id()} {shortRequestId(requestId)}
        </p>
      ) : null}
      <Button variant="outline" size="sm" onClick={onRetry}>
        {m.settings_error_retry()}
      </Button>
    </div>
  );
}

/**
 * Reusable error boundary for settings (and any other feature surface) that
 * follows the same fallback shape across the product. Pass `resetQueryKey`
 * to reset a specific tree of React Query queries on retry.
 */
export function SettingsErrorBoundary({
  children,
  resetQueryKey,
}: {
  children: ReactNode;
  resetQueryKey?: ReadonlyArray<unknown>;
}) {
  return (
    <ErrorBoundary
      fallback={({ error, requestId, reset }) => (
        <SettingsErrorFallback
          error={error}
          requestId={requestId}
          reset={reset}
          resetQueryKey={resetQueryKey}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
