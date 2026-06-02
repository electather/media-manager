import type { ErrorComponentProps } from "@tanstack/react-router";
import { LibraryErrorFallback } from "./library-error-fallback";

/**
 * Route-level `errorComponent` for the `/library/*` routes. When a loader's
 * prefetch rejects the route component never mounts, so there is no inner
 * ErrorBoundary to catch it — this renders instead. `reset` re-runs the loader
 * after the fallback's retry clears the cached failure.
 */
export function LibraryRouteError({ error, reset }: ErrorComponentProps) {
  return <LibraryErrorFallback error={error} resetErrorBoundary={reset} />;
}
