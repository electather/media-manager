import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
import { m } from "@/paraglide/messages";

import { settingsAppsKeys } from "../lib/query-keys";
import { SettingsAppsApiError } from "../lib/types";

function SettingsAppsErrorFallback({
  error,
  requestId,
  reset,
}: {
  error: Error;
  requestId: string;
  reset: () => void;
}) {
  const queryClient = useQueryClient();
  const code = error instanceof SettingsAppsApiError ? error.code : undefined;
  const onRetry = () => {
    void queryClient.resetQueries({ queryKey: settingsAppsKeys.all });
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
        {code ? <ErrorStateReference>{code}</ErrorStateReference> : null}
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

export function SettingsAppsErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={({ error, requestId, reset }) => (
        <SettingsAppsErrorFallback error={error} requestId={requestId} reset={reset} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
