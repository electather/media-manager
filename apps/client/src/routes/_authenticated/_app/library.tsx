import { createFileRoute, Outlet } from "@tanstack/react-router";

import { ErrorBoundary } from "@/shared/components/error-boundary";
import {
  LibraryLayout,
  LibraryRouteError,
  LibrarySkeleton,
  libraryDataQueryOptions,
  librarySearchSchema,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library")({
  // Filters live in the URL so the shared header and the active lens route read
  // one source of truth; the schema is inherited by every `/library/*` child.
  validateSearch: librarySearchSchema,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(libraryDataQueryOptions()),
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
