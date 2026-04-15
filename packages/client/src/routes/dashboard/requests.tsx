import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/requests")({
  component: RequestsPage,
});

function RequestsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Requests</h1>
      <p className="text-muted-foreground">Download requests and their status</p>
    </div>
  );
}
