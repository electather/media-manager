import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import {
  ErrorScreen,
  ErrorState,
  ErrorStateActions,
  ErrorStateContent,
  ErrorStateDescription,
  ErrorStateMedia,
  ErrorStateReference,
  ErrorStateTitle,
} from "@/shared/components/error-state";
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

  // fallow-ignore-next-line complexity
  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const requestId = this.state.requestId ?? "";
    if (this.props.fallback) {
      return this.props.fallback({ error: this.state.error, requestId, reset: this.reset });
    }
    return (
      <ErrorScreen>
        <ErrorState orientation="vertical">
          <ErrorStateMedia size="lg" />
          <ErrorStateContent>
            <ErrorStateTitle>{m.errors_default_title()}</ErrorStateTitle>
            <ErrorStateDescription>{this.state.error.message}</ErrorStateDescription>
            {requestId ? (
              <ErrorStateReference>
                {m.errors_ref_prefix({ ref: shortRequestId(requestId) })}
              </ErrorStateReference>
            ) : null}
          </ErrorStateContent>
          <ErrorStateActions>
            <Button variant="outline" size="sm" onClick={this.reset}>
              <RotateCcwIcon aria-hidden="true" />
              {m.errors_retry()}
            </Button>
          </ErrorStateActions>
        </ErrorState>
      </ErrorScreen>
    );
  }
}
