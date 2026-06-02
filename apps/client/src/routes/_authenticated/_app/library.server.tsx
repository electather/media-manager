import { createFileRoute } from "@tanstack/react-router";

import {
  LibraryContentSkeleton,
  LibraryRouteError,
  ServersLensPage,
  libraryDataQueryOptions,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/server")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(libraryDataQueryOptions()),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: ServersLensPage,
});
