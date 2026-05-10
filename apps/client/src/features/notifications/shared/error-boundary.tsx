import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HomeIcon, RotateCcwIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  ErrorPage,
  ErrorPageActions,
  ErrorPageDescription,
  ErrorPageDetails,
  ErrorPageFrame,
  ErrorPageHeadline,
} from "@/shared/components/error-page";
import { reportError } from "@/shared/lib/diagnostics/report";
import { shortRequestId } from "@/shared/lib/diagnostics/request-id";
import { Button } from "@/shared/ui/button";
import { notificationsKeys } from "./query-keys";
import { NotificationsApiError } from "./types";

const TELEMETRY_CODE = "client.notifications.boundary";

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
  const status =
    error instanceof NotificationsApiError && typeof error.status === "number"
      ? error.status
      : null;
  const code = status ? String(status) : "ERR";
  useEffect(() => {
    void reportError(error, "warning", { requestId, status: status ?? undefined }, TELEMETRY_CODE);
  }, [error, requestId, status]);
  const onRetry = () => {
    void queryClient.resetQueries({ queryKey: notificationsKeys.all });
    reset();
  };
  const shortId = requestId ? shortRequestId(requestId) : "";
  return (
    <ErrorPage tone="danger">
      <ErrorPageFrame>
        <ErrorPageHeadline code={code} eyebrow={m.errors_server_eyebrow()}>
          {m.notifications_error_title()}
        </ErrorPageHeadline>
        <ErrorPageDescription>{message}</ErrorPageDescription>
        <ErrorPageActions>
          <Button onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {m.notifications_error_retry()}
          </Button>
          <Button variant="outline" render={<Link to="/" />}>
            <HomeIcon aria-hidden="true" />
            {m.errors_action_back_home()}
          </Button>
        </ErrorPageActions>
        {shortId ? (
          <ErrorPageDetails
            title={m.errors_details_title()}
            reference={shortId}
            rows={[
              {
                label: m.errors_details_request_id(),
                value: shortId,
                copyValue: requestId,
              },
              {
                label: m.errors_details_status(),
                value: `${code} · ${m.notifications_error_title()}`,
              },
            ]}
          />
        ) : null}
      </ErrorPageFrame>
    </ErrorPage>
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
