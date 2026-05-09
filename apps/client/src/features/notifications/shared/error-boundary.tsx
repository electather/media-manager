import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  ErrorScreen,
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
import { notificationsKeys } from "./query-keys";
import { NotificationsApiError } from "./types";

// fallow-ignore-next-line complexity
function FallbackInner({
  error,
  requestId,
  reset,
}: {
  error: Error;
  requestId: string;
  reset: () => void;
}) {
  const queryClient = useQueryClient();
  const message =
    error instanceof NotificationsApiError && error.body?.message
      ? error.body.message
      : error.message;
  const onRetry = () => {
    void queryClient.resetQueries({ queryKey: notificationsKeys.all });
    reset();
  };
  return (
    <ErrorScreen>
      <ErrorState orientation="vertical">
        <ErrorStateMedia size="lg" />
        <ErrorStateContent>
          <ErrorStateTitle>{m.notifications_error_title()}</ErrorStateTitle>
          <ErrorStateDescription>{message}</ErrorStateDescription>
          {requestId ? (
            <ErrorStateReference>
              {m.errors_ref_prefix({ ref: shortRequestId(requestId) })}
            </ErrorStateReference>
          ) : null}
        </ErrorStateContent>
        <ErrorStateActions>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {m.notifications_error_retry()}
          </Button>
        </ErrorStateActions>
      </ErrorState>
    </ErrorScreen>
  );
}

/** Standalone fallback for use as a route-level `errorComponent`. */
export function NotificationsErrorFallback({ error }: { error: Error }) {
  return (
    <FallbackInner
      error={error}
      requestId={document.documentElement.dataset.requestId ?? ""}
      reset={() => window.location.reload()}
    />
  );
}

export function NotificationsErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={({ error, requestId, reset }) => (
        <FallbackInner error={error} requestId={requestId} reset={reset} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
