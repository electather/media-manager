import { createFileRoute } from "@tanstack/react-router";

import {
  LibraryContentSkeleton,
  LibraryRouteError,
  ServersLensPage,
  prefetchLibraryLens,
  searchToFilters,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/server")({
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps }) =>
    prefetchLibraryLens(queryClient, "server", searchToFilters(deps.search)),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: ServersLensPage,
});
