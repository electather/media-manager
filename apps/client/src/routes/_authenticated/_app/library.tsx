import { createFileRoute } from "@tanstack/react-router";

import { LibraryPage } from "@/features/library";

export const Route = createFileRoute("/_authenticated/_app/library")({
  component: LibraryPage,
});
