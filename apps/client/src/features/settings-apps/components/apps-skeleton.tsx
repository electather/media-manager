import { Skeleton } from "@/shared/ui/skeleton";

export function AppsSkeleton() {
  return (
    <div className="flex flex-col gap-7">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}
