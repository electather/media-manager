import { Skeleton } from "@/shared/ui/skeleton";

export function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      <Skeleton className="h-9 w-56" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
