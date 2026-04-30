import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/")({
  component: HomeScrollHarness,
});

function HomeScrollHarness() {
  return (
    <div className="mx-auto w-full max-w-350 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Scroll harness</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Scroll past 8px to lift the nav. Placeholder content below.
      </p>
      <div className="mt-10 grid gap-6">
        {Array.from({ length: 24 }).map((_, i) => (
          <PlaceholderRow key={i} index={i + 1} />
        ))}
      </div>
    </div>
  );
}

function PlaceholderRow({ index }: { index: number }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Section {index}</div>
      <div className="mt-2 text-lg font-medium text-foreground">Placeholder row</div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, j) => (
          <div key={j} className="aspect-[2/3] rounded-md bg-accent" aria-hidden />
        ))}
      </div>
    </section>
  );
}
