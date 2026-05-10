import { Component, type ErrorInfo, type ReactNode } from "react";
import { HomeIcon, RotateCcwIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
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

interface Props {
  children: ReactNode;
  fallback?: (args: { error: Error; requestId: string; reset: () => void }) => ReactNode;
}

interface State {
  error: Error | null;
  requestId: string | null;
}

/** Captures render-time exceptions anywhere in its subtree, reports them to the
 *  backend via /api/diagnostics/errors, and shows a fallback UI that includes the short-form
 *  request id so users can reference it in support requests. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, requestId: null };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      requestId: document.documentElement.dataset.requestId ?? null,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Feature-specific boundaries (e.g. `HomeErrorBoundary`) own their own
    // variant-aware telemetry path; reporting here too would double-fire on
    // every catch. Only emit the generic event when this is the default fallback.
    if (this.props.fallback) return;
    void reportError(error, "error", { componentStack: info.componentStack ?? undefined });
  }

  private reset = (): void => {
    this.setState({ error: null, requestId: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const requestId = this.state.requestId ?? "";
    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, requestId, reset: this.reset });
    }
    const shortId = requestId ? shortRequestId(requestId) : "";
    return (
      <ErrorPage tone="danger">
        <ErrorPageFrame>
          <ErrorPageHeadline code="500" eyebrow={m.errors_server_eyebrow()}>
            {m.errors_default_title()}
          </ErrorPageHeadline>
          <ErrorPageDescription>{this.state.error.message}</ErrorPageDescription>
          <ErrorPageActions>
            <Button onClick={this.reset}>
              <RotateCcwIcon aria-hidden="true" />
              {m.errors_retry()}
            </Button>
            <Button variant="outline" render={<a href="/" />}>
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
                  value: `500 · ${m.errors_status_server_error()}`,
                },
              ]}
            />
          ) : null}
        </ErrorPageFrame>
      </ErrorPage>
    );
  }
}
