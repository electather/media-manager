import { createFileRoute } from "@tanstack/react-router";

import {
  AzLensPage,
  LibraryContentSkeleton,
  LibraryRouteError,
  prefetchLibraryLens,
  searchToFilters,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/")({
  // Re-run the loader when the URL filters change so the warmed first page
  // matches the active facet selection (the suspense hook keys on the same).
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps }) =>
    prefetchLibraryLens(queryClient, "az", searchToFilters(deps.search)),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: (props) => <LibraryRouteError {...props} lens="az" />,
  component: AzLensPage,
});
