import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { reportError } from "@/shared/lib/errors/report";
import { shortRequestId } from "@/shared/lib/errors/request-id";
import { Button } from "@/shared/ui/button";
import { HomeFeedSkeleton } from "../components/home-feed-skeleton";
import { classifyHomeError, type HomeErrorView } from "./error-classification";
import { homeKeys } from "./query-keys";

const TELEMETRY_CODE = "client.home.boundary";
const RELOGIN_HREF = "/login";

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

  if (isResetting) return <HomeFeedSkeleton />;

  // Render the home skeleton during the reset window so the page never flashes
  // the empty fallback before Suspense re-suspends on the in-flight fetch.
  const onRetry = () => {
    setIsResetting(true);
    void queryClient.resetQueries({ queryKey: homeKeys.all }).finally(() => {
      reset();
    });
  };

  const onRelogin = () => {
    if (typeof window !== "undefined") window.location.assign(RELOGIN_HREF);
  };

  const titleFn = m[view.titleKey] as () => string;
  const bodyFn = m[view.bodyKey] as () => string;
  const detail = view.devMessage;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center"
      data-home-error-variant={view.variant}
    >
      <h2 className="text-lg font-semibold">{titleFn()}</h2>
      <p className="text-sm text-muted-foreground">{bodyFn()}</p>
      {detail ? <p className="max-w-md text-xs text-muted-foreground/80">{detail}</p> : null}
      {requestId ? (
        <p className="text-xs font-mono text-muted-foreground">
          {m.home_error_ref_prefix({ ref: shortRequestId(requestId) })}
        </p>
      ) : null}
      <ActionButtons view={view} onRetry={onRetry} onRelogin={onRelogin} />
    </div>
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
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="default" size="sm" onClick={onRelogin}>
          {m.home_error_action_relogin()}
        </Button>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {m.home_error_retry()}
        </Button>
      </div>
    );
  }
  if (view.variant === "server") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          {m.home_error_retry()}
        </Button>
        <a
          href="https://github.com/electather/media-manager/issues/new"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {m.home_error_action_contact_support()}
        </a>
      </div>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={onRetry}>
      {m.home_error_retry()}
    </Button>
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
