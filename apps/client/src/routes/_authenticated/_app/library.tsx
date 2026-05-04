import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/library")({
  component: LibraryRoute,
});

function LibraryRoute() {
  return <div>Library coming soon</div>;
}
