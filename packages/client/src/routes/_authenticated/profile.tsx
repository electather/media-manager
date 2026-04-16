import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Taste Profile</h1>
      <p className="text-muted-foreground">
        Visualise and tune what the system knows about your preferences. Shows a genre affinity
        chart with adjustable sliders, a theme/keyword cloud, top directors and actors derived from
        ratings, a rating distribution histogram, a scrollable feedback history with per-entry
        deletion, and a reset profile button that rebuilds scores from raw feedback.
      </p>
    </div>
  );
}
