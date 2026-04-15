import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">ent-mcp</h1>
      <p className="text-muted-foreground">Entertainment management dashboard</p>
    </div>
  );
}
