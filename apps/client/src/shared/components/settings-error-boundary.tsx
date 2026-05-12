import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { m } from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateMedia,
  ErrorStateReference,
  ErrorStateTitle,
} from "@/shared/components/error-state";
import { shortRequestId } from "@/shared/lib/diagnostics/request-id";
import { Button } from "@/shared/ui/button";

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
    <ErrorState orientation="vertical">
      <ErrorStateMedia size="lg" />
      <ErrorStateContent>
        <ErrorStateTitle>{m.settings_error_title()}</ErrorStateTitle>
        <ErrorStateDescription>
          {error.message || m.settings_error_description()}
        </ErrorStateDescription>
        {requestId ? (
          <ErrorStateReference>
            {m.settings_error_request_id()} {shortRequestId(requestId)}
          </ErrorStateReference>
        ) : null}
      </ErrorStateContent>
      <ErrorStateActions>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {m.settings_error_retry()}
        </Button>
      </ErrorStateActions>
    </ErrorState>
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
