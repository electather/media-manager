import { Skeleton } from "@/shared/ui/skeleton";

export function WatchlistSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-10 px-4 pt-6 pb-32 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3.5 w-44" />
        <Skeleton className="h-14 w-72" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
      <div className="flex gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] w-44 shrink-0 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
