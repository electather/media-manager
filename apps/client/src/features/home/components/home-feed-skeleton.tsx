import { Skeleton } from "@/shared/ui/skeleton";

export function HomeFeedSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-10 px-4 pb-32 sm:px-6 lg:px-8">
      <Skeleton className="aspect-16/7 w-full rounded-lg" />
      <div className="flex flex-col gap-6">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}
