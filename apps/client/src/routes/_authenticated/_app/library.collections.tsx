import { createFileRoute } from "@tanstack/react-router";

import {
  CollectionsLensPage,
  LibraryContentSkeleton,
  LibraryRouteError,
  libraryDataQueryOptions,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/collections")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(libraryDataQueryOptions()),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: CollectionsLensPage,
});
