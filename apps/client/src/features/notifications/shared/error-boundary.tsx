import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { shortRequestId } from "@/shared/lib/errors/request-id";
import { m } from "@/paraglide/messages";
import { notificationsKeys } from "./query-keys";
import { NotificationsApiError } from "./types";

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
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold">{m.notifications_error_title()}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      {requestId ? (
        <p className="text-xs font-mono text-muted-foreground">Ref: {shortRequestId(requestId)}</p>
      ) : null}
      <Button variant="outline" size="sm" onClick={onRetry}>
        {m.notifications_error_retry()}
      </Button>
    </div>
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
