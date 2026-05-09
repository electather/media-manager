import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";

import * as m from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  ErrorScreen,
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateDetail,
  ErrorStateMedia,
  ErrorStateReference,
  ErrorStateTitle,
} from "@/shared/components/error-state";
import { reportError } from "@/shared/lib/diagnostics/report";
import { shortRequestId } from "@/shared/lib/diagnostics/request-id";
import { Button } from "@/shared/ui/button";
import { HomeFeedSkeleton } from "../components/home-feed-skeleton";
import { classifyHomeError, type HomeErrorView } from "./error-classification";
import { homeKeys } from "./query-keys";

const TELEMETRY_CODE = "client.home.boundary";
const RELOGIN_HREF = "/login";
const SUPPORT_HREF = "https://github.com/electather/media-manager/issues/new";

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
  const view = classifyHomeError(error);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    void reportError(error, "warning", { variant: view.variant, requestId }, TELEMETRY_CODE);
  }, [error, requestId, view.variant]);

  // Render the home skeleton during the reset window so the page never flashes
  // the empty fallback before Suspense re-suspends on the in-flight fetch.
  const onRetry = useCallback(() => {
    setIsResetting(true);
    void queryClient.resetQueries({ queryKey: homeKeys.all }).finally(() => {
      reset();
    });
  }, [queryClient, reset]);

  const onRelogin = useCallback(() => {
    if (typeof window !== "undefined") window.location.assign(RELOGIN_HREF);
  }, []);

  if (isResetting) return <HomeFeedSkeleton />;

  const titleFn = m[view.titleKey] as () => string;
  const bodyFn = m[view.bodyKey] as () => string;
  const detail = view.devMessage;

  return (
    <ErrorScreen>
      <ErrorState orientation="vertical" data-home-error-variant={view.variant}>
        <ErrorStateMedia size="lg" />
        <ErrorStateContent>
          <ErrorStateTitle>{titleFn()}</ErrorStateTitle>
          <ErrorStateDescription>{bodyFn()}</ErrorStateDescription>
          {detail ? <ErrorStateDetail>{detail}</ErrorStateDetail> : null}
          {requestId ? (
            <ErrorStateReference>
              {m.home_error_ref_prefix({ ref: shortRequestId(requestId) })}
            </ErrorStateReference>
          ) : null}
        </ErrorStateContent>
        <ErrorStateActions>
          <ActionButtons view={view} onRetry={onRetry} onRelogin={onRelogin} />
        </ErrorStateActions>
      </ErrorState>
    </ErrorScreen>
  );
}

function ActionButtons({
  view,
  onRetry,
  onRelogin,
}: {
  view: HomeErrorView;
  onRetry: () => void;
  onRelogin: () => void;
}) {
  if (view.needsRelogin) {
    return (
      <>
        <Button variant="default" size="sm" onClick={onRelogin}>
          {m.home_error_action_relogin()}
        </Button>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcwIcon aria-hidden="true" />
          {m.home_error_retry()}
        </Button>
      </>
    );
  }
  if (view.variant === "server") {
    return (
      <>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcwIcon aria-hidden="true" />
          {m.home_error_retry()}
        </Button>
        <a
          href={SUPPORT_HREF}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {m.home_error_action_contact_support()}
        </a>
      </>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RotateCcwIcon aria-hidden="true" />
      {m.home_error_retry()}
    </Button>
  );
}

/** Standalone fallback for use as a route-level `errorComponent`, where there
 *  is no boundary stack to reset and no captured request id to display. */
export function HomeErrorFallback({ error }: { error: Error }) {
  return (
    <FallbackInner
      error={error}
      requestId={document.documentElement.dataset.requestId ?? ""}
      reset={() => window.location.reload()}
    />
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
