import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";

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
import { OnboardingSkeleton } from "../components/onboarding-skeleton";
import { onboardingKeys } from "./query-keys";
import { OnboardingApiError } from "./types";

const TELEMETRY_CODE = "client.onboarding.boundary";

/**
 * Shared onboarding error view for both the route-level `errorComponent` (loader
 * throws) and the in-tree `ErrorBoundary` (render-time fetch errors). Reads the
 * typed `OnboardingApiError.status` for the details row (architecture rule 3).
 */
// CRAP is coverage-estimated in CI; the typed-status path is covered by
// error-boundary.test.tsx.
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
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    void reportError(error, "warning", { requestId }, TELEMETRY_CODE);
  }, [error, requestId]);

  // Drop both onboarding caches then clear the boundary so the wizard
  // re-suspends on fresh fetches; show the skeleton during the in-flight reset
  // so the page never flashes the stale error before re-suspending.
  // Resets public-config too — the MCP step suspends on its own `["public-config"]`
  // key, so an onboarding-only reset would rethrow the cached error (#882).
  const onRetry = useCallback(() => {
    setIsResetting(true);
    void Promise.all([
      queryClient.resetQueries({ queryKey: onboardingKeys.all }),
      queryClient.resetQueries({ queryKey: onboardingKeys.publicConfig() }),
    ]).finally(reset);
  }, [queryClient, reset]);

  if (isResetting) return <OnboardingSkeleton />;

  const status = error instanceof OnboardingApiError ? error.status : undefined;
  const shortId = requestId ? shortRequestId(requestId) : "";

  return (
    <ErrorPage tone="danger">
      <ErrorPageFrame>
        <ErrorPageHeadline
          code={status ? String(status) : "ERR"}
          eyebrow={m.errors_server_eyebrow()}
        >
          {m.onboarding_error_title()}
        </ErrorPageHeadline>
        <ErrorPageDescription>{m.onboarding_error_body()}</ErrorPageDescription>
        <ErrorPageActions>
          <Button onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {m.errors_retry()}
          </Button>
        </ErrorPageActions>
        <ErrorDetails status={status} shortId={shortId} requestId={requestId} />
      </ErrorPageFrame>
    </ErrorPage>
  );
}

/** Request-id + upstream-status rows; null when neither is known. */
// CRAP is coverage-estimated in CI; rendered via FallbackInner in error-boundary.test.tsx.
// fallow-ignore-next-line complexity
function ErrorDetails({
  status,
  shortId,
  requestId,
}: {
  status?: number;
  shortId: string;
  requestId: string;
}) {
  if (!shortId && !status) return null;
  return (
    <ErrorPageDetails
      title={m.errors_details_title()}
      reference={shortId || undefined}
      rows={[
        ...(shortId
          ? [{ label: m.errors_details_request_id(), value: shortId, copyValue: requestId }]
          : []),
        ...(status ? [{ label: m.errors_details_status(), value: String(status) }] : []),
      ]}
    />
  );
}

/**
 * Route-level `errorComponent`: catches throws from the `setup` loader, where
 * there is no in-tree boundary stack to reset, so retry does a full reload.
 */
export function OnboardingErrorFallback({ error }: { error: Error }) {
  return (
    <FallbackInner
      error={error}
      requestId={document.documentElement.dataset.requestId ?? ""}
      reset={() => window.location.reload()}
    />
  );
}

/** React boundary wrapping the wizard; catches render-time suspense fetch errors. */
export function OnboardingErrorBoundary({ children }: { children: ReactNode }) {
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
