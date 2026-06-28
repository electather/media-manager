import type { ErrorComponentProps } from "@tanstack/react-router";
import type { LibraryLens } from "@nama/shared/library";
import { LibraryErrorFallback } from "./library-error-fallback";

/**
 * Route-level `errorComponent` for the `/library/*` routes. When a loader's
 * prefetch rejects the route component never mounts, so there is no inner
 * ErrorBoundary to catch it — this renders instead. `reset` re-runs the loader
 * after the fallback's retry clears the cached failure. The item-lens routes
 * pass their `lens` so the retry scopes its media reset to that lens's source;
 * the layout + collections routes omit it (they read no media source).
 */
export function LibraryRouteError({
  lens,
  error,
  reset,
}: ErrorComponentProps & { lens?: Exclude<LibraryLens, "collections"> }) {
  return <LibraryErrorFallback lens={lens} error={error} resetErrorBoundary={reset} />;
}
