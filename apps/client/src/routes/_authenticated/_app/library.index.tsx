import { createFileRoute } from "@tanstack/react-router";

import {
  AzLensPage,
  LibraryContentSkeleton,
  LibraryRouteError,
  libraryDataQueryOptions,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(libraryDataQueryOptions()),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: AzLensPage,
});
