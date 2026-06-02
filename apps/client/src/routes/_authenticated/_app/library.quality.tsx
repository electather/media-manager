import { createFileRoute } from "@tanstack/react-router";

import {
  LibraryContentSkeleton,
  LibraryRouteError,
  QualityLensPage,
  libraryDataQueryOptions,
} from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library/quality")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(libraryDataQueryOptions()),
  pendingComponent: LibraryContentSkeleton,
  errorComponent: LibraryRouteError,
  component: QualityLensPage,
});
