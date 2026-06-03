import { createFileRoute, Outlet } from "@tanstack/react-router";

import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  LibraryLayout,
  LibraryRouteError,
  LibrarySkeleton,
  facetsQueryOptions,
  librarySearchSchema,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library")({
  // Filters live in the URL so the shared header and the active lens route read
  // one source of truth; the schema is inherited by every `/library/*` child.
  validateSearch: librarySearchSchema,
  // Warm the (non-blocking, unfiltered) facets so the header's pills + counts
  // paint on first mount; the per-lens first page is prefetched by each child
  // lens route. `void`-fire so a slow facets read never blocks the route.
  loader: ({ context: { queryClient } }) => {
    void queryClient.ensureQueryData(facetsQueryOptions());
  },
  pendingComponent: LibrarySkeleton,
  errorComponent: LibraryRouteError,
  component: LibraryLayoutRoute,
});

function LibraryLayoutRoute() {
  return (
    <ErrorBoundary>
      <LibraryLayout>
        <Outlet />
      </LibraryLayout>
    </ErrorBoundary>
  );
}
