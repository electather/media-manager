import { Skeleton } from "@/shared/ui/skeleton";

export function DeliveriesSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: 12 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
