import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HomeIcon, RotateCcwIcon } from "lucide-react";

import * as m from "@/paraglide/messages";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  ErrorPage,
  ErrorPageActions,
  ErrorPageDescription,
  ErrorPageDetails,
  ErrorPageFrame,
  ErrorPageHeadline,
  ErrorPageHelp,
} from "@/shared/components/error-page";
import { reportError } from "@/shared/lib/diagnostics/report";
import { shortRequestId } from "@/shared/lib/diagnostics/request-id";
import { Button } from "@/shared/ui/button";
import { HomeFeedSkeleton } from "../components/home-feed-skeleton";
import {
  classifyHomeError,
  type HomeErrorVariant,
  type HomeErrorView,
} from "./error-classification";
import { homeKeys } from "./query-keys";

const TELEMETRY_CODE = "client.home.boundary";
const RELOGIN_HREF = "/login";
const SUPPORT_HREF = "https://github.com/electather/media-manager/issues/new";

interface VariantMeta {
  tone: "info" | "warn" | "danger";
  code: string;
  eyebrowKey: keyof typeof m;
}

// One source of truth for variant → presentation. Code + eyebrow read like the
// Nama prototype's mono callouts; tone drives the ambient gradient on the stage.
const VARIANT_META: Record<HomeErrorVariant, VariantMeta> = {
  auth: { tone: "danger", code: "401", eyebrowKey: "errors_unauthorized_eyebrow" },
  offline: { tone: "warn", code: "OFFLINE", eyebrowKey: "errors_offline_eyebrow" },
  network: { tone: "warn", code: "429", eyebrowKey: "errors_rate_limited_eyebrow" },
  server: { tone: "danger", code: "500", eyebrowKey: "errors_server_eyebrow" },
  unknown: { tone: "danger", code: "ERR", eyebrowKey: "errors_server_eyebrow" },
};

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
  const meta = VARIANT_META[view.variant];
  const eyebrowFn = m[meta.eyebrowKey] as () => string;
  const detail = view.devMessage;
  const shortId = requestId ? shortRequestId(requestId) : "";

  return (
    <ErrorPage tone={meta.tone}>
      <ErrorPageFrame data-home-error-variant={view.variant}>
        <ErrorPageHeadline code={meta.code} eyebrow={eyebrowFn()}>
          {titleFn()}
        </ErrorPageHeadline>
        <ErrorPageDescription>{bodyFn()}</ErrorPageDescription>
        {detail ? (
          <p className="max-w-md font-mono text-xs leading-relaxed text-muted-foreground/80">
            {detail}
          </p>
        ) : null}
        <ErrorPageActions>
          <ActionButtons view={view} onRetry={onRetry} onRelogin={onRelogin} />
        </ErrorPageActions>
        {shortId || detail ? (
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
                value: `${meta.code} · ${titleFn()}`,
              },
              ...(detail
                ? [
                    {
                      label: "Detail",
                      value: detail,
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
        {view.variant === "server" ? (
          <ErrorPageHelp>
            <a href={SUPPORT_HREF} target="_blank" rel="noreferrer">
              {m.home_error_action_contact_support()}
            </a>
          </ErrorPageHelp>
        ) : null}
      </ErrorPageFrame>
    </ErrorPage>
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
        <Button onClick={onRelogin}>{m.home_error_action_relogin()}</Button>
        <Button variant="outline" onClick={onRetry}>
          <RotateCcwIcon aria-hidden="true" />
          {m.home_error_retry()}
        </Button>
      </>
    );
  }
  return (
    <>
      <Button onClick={onRetry}>
        <RotateCcwIcon aria-hidden="true" />
        {m.home_error_retry()}
      </Button>
      <Button variant="outline" render={<a href="/" />}>
        <HomeIcon aria-hidden="true" />
        {m.errors_action_back_home()}
      </Button>
    </>
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
