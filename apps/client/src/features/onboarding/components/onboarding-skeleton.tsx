import { Skeleton } from "@/shared/ui/skeleton";

/**
 * Loading placeholder shown while the server-resolved onboarding state loads.
 * Mirrors the wizard chrome (header, stepper card, footer) so the route does
 * not flash empty before the suspense read resolves.
 */
export function OnboardingSkeleton() {
  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </header>

        <div className="overflow-hidden rounded-xl border">
          <div className="flex items-center gap-4 border-b px-6 py-4">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-24" />
          </div>
          <div className="flex flex-col gap-4 px-6 py-6">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </footer>
      </div>
    </div>
  );
}
