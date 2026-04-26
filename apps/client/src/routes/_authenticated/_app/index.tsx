import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/")({
  component: HomePage,
});

function HomePage() {
  // Demo-only filler so the page is long enough to test scroll-driven UI.
  const demoSections = Array.from({ length: 30 }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Home</h1>
      <p className="text-muted-foreground">
        Overview page. Shows connection status cards (one per service), recent Trakt watch history
        feed, upcoming episodes for in-progress shows, active Seerr download requests, and a taste
        profile summary with top genres and top directors/actors.
      </p>
      {demoSections.map((n) => (
        <section key={n} className="rounded-2xl border border-border bg-card/40 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Demo section {n}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Filler content to make the home page tall for scroll testing. Replace once real sections
            are wired up.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="h-24 rounded-xl bg-foreground/5" />
            <div className="h-24 rounded-xl bg-foreground/5" />
          </div>
        </section>
      ))}
    </div>
  );
}
