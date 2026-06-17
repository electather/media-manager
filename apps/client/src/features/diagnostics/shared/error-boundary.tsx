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
import { diagnosticsKeys } from "./query-keys";
import { DiagnosticsApiError } from "./types";

const TELEMETRY_CODE = "client.diagnostics.boundary";

// fallow-ignore-next-line complexity
function FallbackInner({
  error,
  requestId,
  reset,
  title,
  body,
  queryKey,
}: {
  error: Error;
  requestId: string;
  reset: () => void;
  title: string;
  body: string;
  queryKey?: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  // Narrow the typed error to read the server-shipped diagnostic message and
  // status instead of parsing the generic Error string.
  const message =
    error instanceof DiagnosticsApiError && error.body?.devMessage
      ? error.body.devMessage
      : error.message;
  const status =
    error instanceof DiagnosticsApiError && typeof error.status === "number" ? error.status : null;
  const code = status ? String(status) : "ERR";
  useEffect(() => {
    void reportError(error, "warning", { requestId, status: status ?? undefined }, TELEMETRY_CODE);
  }, [error, requestId, status]);
  const onRetry = () => {
    // Reset only the failing surface's queries when a scoped key is provided,
    // avoiding unnecessary re-suspension of unrelated diagnostics surfaces.
    void queryClient.resetQueries({ queryKey: queryKey ?? diagnosticsKeys.all });
    reset();
  };
  const shortId = requestId ? shortRequestId(requestId) : "";
  return (
    <ErrorPage tone="danger">
      <ErrorPageFrame>
        <ErrorPageHeadline code={code} eyebrow={m.errors_server_eyebrow()}>
          {title}
        </ErrorPageHeadline>
        <ErrorPageDescription>{body}</ErrorPageDescription>
        <ErrorPageActions>
          <Button onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {m.diagnostics_errors_retry()}
          </Button>
          <Button variant="outline" render={<Link to="/" />}>
            <HomeIcon aria-hidden="true" />
            {m.errors_action_back_home()}
          </Button>
        </ErrorPageActions>
        <ErrorPageDetails
          title={m.errors_details_title()}
          reference={shortId || undefined}
          rows={[
            ...(shortId
              ? [
                  {
                    label: m.errors_details_request_id(),
                    value: shortId,
                    copyValue: requestId,
                  },
                ]
              : []),
            {
              label: m.errors_details_status(),
              value: `${code} · ${title}`,
            },
            ...(message
              ? [
                  {
                    label: m.errors_details_message(),
                    value: message,
                  },
                ]
              : []),
          ]}
        />
      </ErrorPageFrame>
    </ErrorPage>
  );
}

/** Wraps a diagnostics surface so a failed Suspense read renders an in-place
 *  fallback that narrows {@link DiagnosticsApiError} rather than tearing down
 *  the route. `title`/`body` let each surface (errors vs perf) supply its own
 *  load-failure copy; they default to the errors strings. Pass `queryKey` to
 *  scope the retry reset to the failing surface's queries only — omitting it
 *  resets all diagnostics queries. */
export function DiagnosticsErrorBoundary({
  children,
  title = m.diagnostics_errors_load_failed_title(),
  body = m.diagnostics_errors_load_failed_body(),
  queryKey,
}: {
  children: ReactNode;
  title?: string;
  body?: string;
  queryKey?: readonly unknown[];
}) {
  return (
    <ErrorBoundary
      fallback={({ error, requestId, reset }) => (
        <FallbackInner
          error={error}
          requestId={requestId}
          reset={reset}
          title={title}
          body={body}
          queryKey={queryKey}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
