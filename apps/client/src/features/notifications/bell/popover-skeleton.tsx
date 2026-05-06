import { Skeleton } from "@/shared/ui/skeleton";

export function PopoverSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
