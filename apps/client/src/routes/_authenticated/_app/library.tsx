import { createFileRoute } from "@tanstack/react-router";

import { LibraryPage } from "@/features/library";
import { ErrorBoundary } from "@/shared/components/error-boundary";

export const Route = createFileRoute("/_authenticated/_app/library")({
  component: () => (
    <ErrorBoundary>
      <LibraryPage />
    </ErrorBoundary>
  ),
});
