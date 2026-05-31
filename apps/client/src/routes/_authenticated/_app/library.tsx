import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage, LibrarySkeleton, libraryDataQueryOptions } from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(libraryDataQueryOptions()),
  pendingComponent: LibrarySkeleton,
  component: LibraryPage,
});
