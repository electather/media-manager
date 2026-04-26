import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/taste")({
  component: TastePage,
});

function TastePage() {
  return (
    <div className="flex flex-col gap-4 px-4 py-6 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Taste</h1>
    </div>
  );
}
