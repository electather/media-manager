import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HomeIcon, RotateCcwIcon } from "lucide-react";

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

import { adminPluginsKeys } from "./query-keys";
import { AdminPluginsApiError } from "./types";

const TELEMETRY_CODE = "client.admin-plugins.boundary";

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
    error instanceof AdminPluginsApiError && error.body?.message
      ? error.body.message
      : error.message;
  const status =
    error instanceof AdminPluginsApiError && typeof error.status === "number" ? error.status : null;
  const code = status ? String(status) : "ERR";
  useEffect(() => {
    void reportError(error, "warning", { requestId, status: status ?? undefined }, TELEMETRY_CODE);
  }, [error, requestId, status]);
  const onRetry = () => {
    void queryClient.resetQueries({ queryKey: adminPluginsKeys.all });
    reset();
  };
  const shortId = requestId ? shortRequestId(requestId) : "";
  return (
    <ErrorPage tone="danger">
      <ErrorPageFrame>
        <ErrorPageHeadline code={code} eyebrow="Server error">
          Couldn't load plugins
        </ErrorPageHeadline>
        <ErrorPageDescription>
          The plugin manager didn't respond. Check the server logs and try again.
        </ErrorPageDescription>
        <ErrorPageActions>
          <Button onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            Retry
          </Button>
          <Button variant="outline" render={<Link to="/" />}>
            <HomeIcon aria-hidden="true" />
            Back home
          </Button>
        </ErrorPageActions>
        <ErrorPageDetails
          title="Details"
          reference={shortId || undefined}
          rows={[
            ...(shortId ? [{ label: "Request ID", value: shortId, copyValue: requestId }] : []),
            { label: "Status", value: `${code} · Couldn't load plugins` },
            ...(message ? [{ label: "Message", value: message }] : []),
          ]}
        />
      </ErrorPageFrame>
    </ErrorPage>
  );
}

export function AdminPluginsErrorFallback({ error }: { error: Error }) {
  return (
    <FallbackInner
      error={error}
      requestId={document.documentElement.dataset.requestId ?? ""}
      reset={() => window.location.reload()}
    />
  );
}

export function AdminPluginsErrorBoundary({ children }: { children: ReactNode }) {
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
