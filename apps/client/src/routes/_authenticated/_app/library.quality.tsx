import { createFileRoute } from "@tanstack/react-router";

import {
  LibraryContentSkeleton,
  LibraryRouteError,
  QualityLensPage,
  prefetchLibraryLens,
  searchToFilters,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/quality")({
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps }) =>
    prefetchLibraryLens(queryClient, "quality", searchToFilters(deps.search)),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: QualityLensPage,
});
