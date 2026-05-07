import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { shortRequestId } from "@/shared/lib/errors/request-id";
import { Button } from "@/shared/ui/button";
import { homeKeys } from "./query-keys";
import { HomeApiError } from "./types";

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
    error instanceof HomeApiError && error.body?.message ? error.body.message : error.message;
  const onRetry = () => {
    void queryClient.resetQueries({ queryKey: homeKeys.all });
    reset();
  };
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold">{m.home_error_title()}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      {requestId ? (
        <p className="text-xs font-mono text-muted-foreground">
          {m.home_error_ref_prefix({ ref: shortRequestId(requestId) })}
        </p>
      ) : null}
      <Button variant="outline" size="sm" onClick={onRetry}>
        {m.home_error_retry()}
      </Button>
    </div>
  );
}

export function HomeErrorBoundary({ children }: { children: ReactNode }) {
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
