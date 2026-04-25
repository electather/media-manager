import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/requests")({
  component: RequestsPage,
});

function RequestsPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Requests</h1>
      <p className="text-muted-foreground">
        Download request management. Lists the user's Seerr requests with title, type, request date,
        and status (requested/processing/available/failed). Admin view (gated by admin:requests)
        shows all users' requests and allows approving or denying pending ones.
      </p>
    </div>
  );
}
