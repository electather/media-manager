import { createFileRoute } from "@tanstack/react-router";

import {
  LibraryContentSkeleton,
  LibraryRouteError,
  TimelineLensPage,
  libraryDataQueryOptions,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/timeline")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(libraryDataQueryOptions()),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: TimelineLensPage,
});
