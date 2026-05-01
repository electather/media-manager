import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/media/$id")({
  component: MediaDetailMockPage,
});

function MediaDetailMockPage() {
  const { id } = Route.useParams();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">Media detail (mock)</h1>
      <p className="text-sm text-muted-foreground">
        Placeholder route for <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{id}</code>.
      </p>
    </div>
  );
}
