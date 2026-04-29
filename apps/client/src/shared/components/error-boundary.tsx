import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/shared/lib/errors/report";
import { shortRequestId } from "@/shared/lib/errors/request-id";
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
 *  backend via /api/errors, and shows a fallback UI that includes the short-form
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
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">{this.state.error.message}</p>
        {requestId ? (
          <p className="text-xs font-mono text-muted-foreground">
            Ref: {shortRequestId(requestId)}
          </p>
        ) : null}
        <Button variant="outline" size="sm" onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}
