import { createFileRoute } from "@tanstack/react-router";

import {
  LibraryContentSkeleton,
  LibraryRouteError,
  TimelineLensPage,
  prefetchLibraryLens,
  searchToFilters,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/timeline")({
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps }) =>
    prefetchLibraryLens(queryClient, "timeline", searchToFilters(deps.search)),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: (props) => <LibraryRouteError {...props} lens="timeline" />,
  component: TimelineLensPage,
});
