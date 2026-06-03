import { createFileRoute } from "@tanstack/react-router";

import {
  CollectionsLensPage,
  LibraryContentSkeleton,
  LibraryRouteError,
  prefetchLibraryCollections,
  searchToFilters,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/collections")({
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps }) =>
    prefetchLibraryCollections(queryClient, searchToFilters(deps.search)),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: CollectionsLensPage,
});
