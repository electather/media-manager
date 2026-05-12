import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

export function PluginsListSkeleton() {
  return (
    <div role="status" aria-label="Loading plugins" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-7 w-14" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-8 flex-1 min-w-[160px]" />
        <Skeleton className="h-8 w-32" />
      </div>
      <Card className="gap-0 overflow-hidden p-0">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-t border-border px-4 py-4 first:border-t-0"
          >
            <Skeleton className="size-10 rounded-md" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-2.5 w-1/2 opacity-60" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}
